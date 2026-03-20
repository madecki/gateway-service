import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { AppConfigService, UpstreamConfig } from '../config';
import { CORRELATION_ID_HEADER, HOP_BY_HOP_HEADERS } from '../common/constants';
import { request as undiciRequest, Dispatcher } from 'undici';
import { JwtVerifierService } from './jwt-verifier.service';
import { getAccessToken } from './cookie.util';

// Prefixes whose requests must carry a valid access_token cookie
const JWT_PROTECTED_PREFIXES = ['/diary'];

@Injectable()
export class ProxyProvider implements OnModuleInit {
  private readonly logger = new Logger(ProxyProvider.name);

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly configService: AppConfigService,
    private readonly jwtVerifier: JwtVerifierService,
  ) {}

  async onModuleInit(): Promise<void> {
    const fastify = this.adapterHost.httpAdapter.getInstance<FastifyInstance>();
    const upstreamConfigs = this.configService.upstreamConfigs;

    for (const config of upstreamConfigs) {
      await this.registerProxy(fastify, config);
    }

    // Also proxy remaining /auth/* requests (JWKS, openid-configuration, etc.)
    // The specific auth cookie routes (login, register, refresh, logout, me) are
    // registered by AuthCookieProvider with higher Fastify route specificity.
    const authUpstream = this.configService.authUpstreamUrl;
    await this.registerProxy(fastify, {
      prefix: '/auth',
      upstream: authUpstream,
      rewritePrefix: '',
    });

    this.logger.log(`Registered ${upstreamConfigs.length + 1} proxy route(s)`);
  }

  private async registerProxy(fastify: FastifyInstance, config: UpstreamConfig): Promise<void> {
    const { prefix, upstream, rewritePrefix } = config;
    const timeout = this.configService.upstreamTimeoutMs;
    const requiresAuth = JWT_PROTECTED_PREFIXES.some((p) => prefix.startsWith(p));

    this.logger.log(
      `API proxy: ${prefix}/* -> ${upstream}${rewritePrefix ?? ''}/* ${requiresAuth ? '[cookie JWT]' : ''}`,
    );

    fastify.all(`${prefix}/*`, async (request: FastifyRequest, reply) => {
      const effective = rewritePrefix !== undefined ? rewritePrefix : prefix;
      const path = effective + request.url.slice(prefix.length);
      const upstreamUrl = new URL(path, upstream);

      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        const lk = key.toLowerCase();
        if (HOP_BY_HOP_HEADERS.includes(lk)) continue;
        if (lk === 'cookie') continue; // Never forward raw cookies to upstreams
        if (value) headers[key] = Array.isArray(value) ? value[0] : value;
      }

      if (request.correlationId) headers[CORRELATION_ID_HEADER] = request.correlationId;
      headers['host'] = new URL(upstream).host;

      if (requiresAuth) {
        const token = getAccessToken(request);
        if (!token) {
          return reply.status(401).send({
            error: { code: 'UNAUTHORIZED', message: 'Not authenticated', correlationId: request.correlationId ?? 'unknown' },
          });
        }

        let userId: string;
        try {
          userId = await this.jwtVerifier.verify(token);
        } catch {
          return reply.status(401).send({
            error: { code: 'UNAUTHORIZED', message: 'Invalid or expired session', correlationId: request.correlationId ?? 'unknown' },
          });
        }

        headers['x-user-id'] = userId;
        headers['x-service-token'] = this.configService.diaryServiceToken;
      }

      let body: string | Buffer | undefined;
      if (request.body) {
        if (Buffer.isBuffer(request.body)) body = request.body;
        else if (typeof request.body === 'string') body = request.body;
        else if (typeof request.body === 'object') body = JSON.stringify(request.body);
      }

      try {
        const response = await undiciRequest(upstreamUrl.toString(), {
          method: request.method as Dispatcher.HttpMethod,
          headers,
          body,
          headersTimeout: timeout,
          bodyTimeout: timeout,
        });

        for (const [key, value] of Object.entries(response.headers)) {
          if (value && !HOP_BY_HOP_HEADERS.includes(key.toLowerCase())) reply.header(key, value);
        }
        reply.status(response.statusCode);
        return reply.send(response.body);
      } catch (error) {
        this.logger.error(
          { correlationId: request.correlationId, upstream: upstreamUrl.toString(), error: error instanceof Error ? error.message : 'Unknown' },
          'Upstream request failed',
        );
        return reply.status(502).send({
          error: { code: 'UPSTREAM_ERROR', message: 'Upstream service unavailable', correlationId: request.correlationId ?? 'unknown' },
        });
      }
    });
  }
}
