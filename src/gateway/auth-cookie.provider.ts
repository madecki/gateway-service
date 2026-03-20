import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { FastifyInstance, FastifyRequest } from 'fastify';
import '@fastify/cookie';
import { request as undiciRequest } from 'undici';
import { AppConfigService } from '../config';
import { CORRELATION_ID_HEADER, HOP_BY_HOP_HEADERS } from '../common/constants';
import { setAuthCookies, clearAuthCookies, getRefreshToken } from './cookie.util';

interface AuthResponse {
  userId: string;
  accessToken: string;
  refreshToken: string;
}

interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthCookieProvider implements OnModuleInit {
  private readonly logger = new Logger(AuthCookieProvider.name);

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly config: AppConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const fastify = this.adapterHost.httpAdapter.getInstance<FastifyInstance>();
    const upstream = this.config.authUpstreamUrl;
    const timeout = this.config.upstreamTimeoutMs;

    // ── login & register: proxy, extract tokens, set cookies ──────

    for (const path of ['/auth/v1/auth/login', '/auth/v1/auth/register'] as const) {
      const upstreamPath = path.replace('/auth', ''); // /v1/auth/login
      fastify.post(path, async (request: FastifyRequest, reply) => {
        const response = await this.proxyJson<AuthResponse>(
          upstream + upstreamPath,
          'POST',
          request,
          request.body,
          timeout,
        );

        if (!response.ok) {
          reply.status(response.status);
          return reply.send(response.body);
        }

        setAuthCookies(reply, response.body.accessToken, response.body.refreshToken, response.body.userId);
        reply.status(response.status);
        // Return only the user ID — tokens stay in cookies, never in the JS-accessible response
        return reply.send({ userId: response.body.userId });
      });

      this.logger.log(`Auth cookie route: POST ${path}`);
    }

    // ── refresh: read cookie → inject into body → update cookies ──

    fastify.post('/auth/v1/auth/refresh', async (request: FastifyRequest, reply) => {
      const refreshToken = getRefreshToken(request);
      if (!refreshToken) {
        // Always clear cookies on any refresh failure so the client ends up with
        // a clean session and the login page does not redirect back to the app.
        clearAuthCookies(reply);
        return reply.status(401).send({
          error: { code: 'UNAUTHORIZED', message: 'No refresh token cookie', correlationId: request.correlationId ?? 'unknown' },
        });
      }

      const response = await this.proxyJson<RefreshResponse>(
        `${upstream}/v1/auth/refresh`,
        'POST',
        request,
        { refreshToken },
        timeout,
      );

      if (!response.ok) {
        clearAuthCookies(reply);
        reply.status(response.status);
        return reply.send(response.body);
      }

      // We need the userId to refresh the user_id cookie — decode it from the new access token
      const userId = decodeUserId(response.body.accessToken);
      setAuthCookies(reply, response.body.accessToken, response.body.refreshToken, userId ?? '');
      reply.status(200);
      return reply.send({ refreshed: true });
    });

    this.logger.log('Auth cookie route: POST /auth/v1/auth/refresh');

    // ── logout: read cookie → inject into body → clear cookies ───

    fastify.post('/auth/v1/auth/logout', async (request: FastifyRequest, reply) => {
      const refreshToken = getRefreshToken(request);
      if (refreshToken) {
        // Best-effort revoke — ignore errors (cookies will be cleared regardless)
        await this.proxyJson(
          `${upstream}/v1/auth/logout`,
          'POST',
          request,
          { refreshToken },
          timeout,
        ).catch(() => undefined);
      }

      clearAuthCookies(reply);
      return reply.status(200).send({ message: 'Logged out successfully' });
    });

    this.logger.log('Auth cookie route: POST /auth/v1/auth/logout');

    // ── /me: forward access token from cookie as Bearer header ───

    fastify.get('/auth/v1/auth/me', async (request: FastifyRequest, reply) => {
      const token = request.cookies['access_token'];
      if (!token) {
        return reply.status(401).send({
          error: { code: 'UNAUTHORIZED', message: 'Not authenticated', correlationId: request.correlationId ?? 'unknown' },
        });
      }

      const headers = this.buildForwardHeaders(request);
      headers['authorization'] = `Bearer ${token}`;
      headers['host'] = new URL(upstream).host;

      try {
        const response = await undiciRequest(`${upstream}/v1/auth/me`, {
          method: 'GET',
          headers,
          headersTimeout: timeout,
          bodyTimeout: timeout,
        });

        for (const [key, value] of Object.entries(response.headers)) {
          if (value && !HOP_BY_HOP_HEADERS.includes(key.toLowerCase())) reply.header(key, value);
        }
        reply.status(response.statusCode);
        return reply.send(response.body);
      } catch {
        return reply.status(502).send({
          error: { code: 'UPSTREAM_ERROR', message: 'Auth service unavailable' },
        });
      }
    });

    this.logger.log('Auth cookie route: GET /auth/v1/auth/me');
  }

  // ── helpers ──────────────────────────────────────────────────────

  private async proxyJson<T>(
    url: string,
    method: string,
    request: FastifyRequest,
    body: unknown,
    timeout: number,
  ): Promise<{ ok: boolean; status: number; body: T }> {
    const headers = this.buildForwardHeaders(request);
    headers['content-type'] = 'application/json';
    headers['host'] = new URL(url).host;

    const response = await undiciRequest(url, {
      method: method as 'POST' | 'GET',
      headers,
      body: JSON.stringify(body),
      headersTimeout: timeout,
      bodyTimeout: timeout,
    });

    const responseBody = (await response.body.json()) as T;
    return { ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, body: responseBody };
  }

  private buildForwardHeaders(request: FastifyRequest): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      const lk = key.toLowerCase();
      if (HOP_BY_HOP_HEADERS.includes(lk)) continue;
      if (lk === 'cookie') continue; // Don't forward cookies to auth-service
      if (value) headers[key] = Array.isArray(value) ? value[0] : value;
    }
    if (request.correlationId) headers[CORRELATION_ID_HEADER] = request.correlationId;
    return headers;
  }
}

/** Decode the sub claim from a JWT without verifying — used only to refresh user_id cookie. */
function decodeUserId(token: string): string | undefined {
  try {
    const [, payload] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof decoded.sub === 'string' ? decoded.sub : undefined;
  } catch {
    return undefined;
  }
}
