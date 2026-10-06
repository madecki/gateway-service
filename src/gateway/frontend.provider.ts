import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { IncomingMessage } from 'http';
import { Duplex } from 'stream';
import { request as undiciRequest, Dispatcher } from 'undici';
// Namespace import so compiled code uses require('ws') directly (no .default); ws is CJS and has no default export.
import * as ws from 'ws';
import { AppConfigService } from '../config';
import { CORRELATION_ID_HEADER, HOP_BY_HOP_HEADERS } from '../common/constants';

/** HMR WebSocket path used by Next.js / Turbopack in dev. */
const HMR_PATH = '/_next/webpack-hmr';
const HMR_PATH_DIARY = '/mfe/diary/_next/webpack-hmr';
const HMR_PATH_SETTINGS = '/mfe/settings/_next/webpack-hmr';
const HMR_PATH_TASKS = '/mfe/tasks/_next/webpack-hmr';

/**
 * Proxies the shell and diary-web Next.js applications through the gateway
 * so that both frontends share the same origin (localhost:3000) as the API
 * routes. This makes httpOnly cookies set by the gateway work automatically
 * for all frontend-to-API calls.
 *
 * In development, HMR WebSocket connections to the gateway are proxied to
 * the shell and diary dev servers so Hot Module Replacement works through
 * the single origin.
 */
@Injectable()
export class FrontendProvider implements OnModuleInit {
  private readonly logger = new Logger(FrontendProvider.name);

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly config: AppConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const fastify = this.adapterHost.httpAdapter.getInstance<FastifyInstance>();
    const timeout = this.config.upstreamTimeoutMs;

    // ── HMR WebSocket proxy (dev only) ─────────────────────────────────────
    // Next.js clients open ws://localhost:3000/_next/webpack-hmr and
    // ws://localhost:3000/mfe/diary/_next/webpack-hmr; the gateway forwards
    // these to the shell and diary dev servers. For diary HMR to be used,
    // diary-web must be run with NEXT_PUBLIC_VIA_GATEWAY=true so asset/HMR
    // URLs are same-origin (gateway) and the browser connects here.
    if (this.config.isDevelopment) {
      this.registerHmrWebSocketProxy(fastify);
    }

    // ── Diary MFE iframe content (/mfe/diary, /mfe/diary/, /mfe/diary/*) ──
    // These paths are loaded inside the shell's iframe. The shell document itself
    // is served by the shell catch-all for all /app/* routes.
    const diaryApp = this.config.diaryAppUpstreamUrl;
    const diaryHandler = async (request: FastifyRequest, reply: FastifyReply) =>
      this.forward(request, reply, diaryApp, timeout);

    fastify.get('/mfe/diary', diaryHandler);
    fastify.get('/mfe/diary/', diaryHandler);
    fastify.all('/mfe/diary/*', diaryHandler);
    this.logger.log(`Frontend proxy: /mfe/diary, /mfe/diary/, /mfe/diary/* -> ${diaryApp}`);

    // ── Settings MFE iframe content (/mfe/settings, ...) ────────────────
    const settingsApp = this.config.settingsAppUpstreamUrl;
    const settingsHandler = async (request: FastifyRequest, reply: FastifyReply) =>
      this.forward(request, reply, settingsApp, timeout);

    fastify.get('/mfe/settings', settingsHandler);
    fastify.get('/mfe/settings/', settingsHandler);
    fastify.all('/mfe/settings/*', settingsHandler);
    this.logger.log(`Frontend proxy: /mfe/settings, /mfe/settings/, /mfe/settings/* -> ${settingsApp}`);

    // ── Task Manager MFE (/mfe/tasks, ...) ───────────────────────────────
    const tasksApp = this.config.tasksAppUpstreamUrl;
    const tasksHandler = async (request: FastifyRequest, reply: FastifyReply) =>
      this.forward(request, reply, tasksApp, timeout);

    fastify.get('/mfe/tasks', tasksHandler);
    fastify.get('/mfe/tasks/', tasksHandler);
    fastify.all('/mfe/tasks/*', tasksHandler);
    this.logger.log(`Frontend proxy: /mfe/tasks, /mfe/tasks/, /mfe/tasks/* -> ${tasksApp}`);

    // ── Shell catch-all (/*) ──────────────────────────────────────
    // Must be registered after all more-specific routes so the Fastify radix
    // tree prefers them. /auth/*, /diary/*, /app/diary/* all take precedence.
    // We register explicit methods (not OPTIONS) to avoid conflicting with the
    // @fastify/cors OPTIONS /* preflight route.
    const shell = this.config.shellUpstreamUrl;
    const shellHandler = async (request: FastifyRequest, reply: FastifyReply) =>
      this.forward(request, reply, shell, timeout);

    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const) {
      fastify.route({ method, url: '/*', handler: shellHandler });
    }
    this.logger.log(`Frontend proxy: /* -> ${shell} (shell catch-all)`);
  }

  private async forward(
    request: FastifyRequest,
    reply: FastifyReply,
    upstream: string,
    timeout: number,
  ) {
    const upstreamUrl = new URL(request.url, upstream);

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (HOP_BY_HOP_HEADERS.includes(key.toLowerCase())) continue;
      if (value) headers[key] = Array.isArray(value) ? value[0] : value;
    }
    if (request.correlationId) headers[CORRELATION_ID_HEADER] = request.correlationId;
    headers['host'] = new URL(upstream).host;

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
    } catch (err) {
      // 502 here is almost always ECONNREFUSED / ETIMEDOUT — MFE dev servers not running or wrong URL.
      this.logger.warn(
        { err, upstream: upstreamUrl.toString(), path: request.url },
        'Frontend upstream unreachable (check DIARY_APP_UPSTREAM_URL / SETTINGS_APP_UPSTREAM_URL / TASKS_APP_UPSTREAM_URL and that Next is listening)',
      );
      return reply.status(502).send({ error: { code: 'UPSTREAM_ERROR', message: 'Frontend unavailable' } });
    }
  }

  private registerHmrWebSocketProxy(fastify: FastifyInstance): void {
    const server = fastify.server;
    if (!server) {
      this.logger.warn('No HTTP server available for HMR WebSocket proxy');
      return;
    }

    const shellBase = this.config.shellUpstreamUrl;
    const diaryBase = this.config.diaryAppUpstreamUrl;
    const settingsBase = this.config.settingsAppUpstreamUrl;
    const tasksBase = this.config.tasksAppUpstreamUrl;
    const wss = new ws.Server({ noServer: true });

    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const pathname = request.url?.split('?')[0] ?? '';
      const isShellHmr = pathname === HMR_PATH || pathname.startsWith(`${HMR_PATH}/`);
      const isDiaryHmr =
        pathname === HMR_PATH_DIARY || pathname.startsWith(`${HMR_PATH_DIARY}/`);
      const isSettingsHmr =
        pathname === HMR_PATH_SETTINGS || pathname.startsWith(`${HMR_PATH_SETTINGS}/`);
      const isTasksHmr =
        pathname === HMR_PATH_TASKS || pathname.startsWith(`${HMR_PATH_TASKS}/`);

      if (!isShellHmr && !isDiaryHmr && !isSettingsHmr && !isTasksHmr) return;

      const upstreamBase = isDiaryHmr
        ? diaryBase
        : isSettingsHmr
          ? settingsBase
          : isTasksHmr
            ? tasksBase
            : shellBase;
      const wsUrl = upstreamBase.replace(/^http/, 'ws') + (request.url ?? '');

      wss.handleUpgrade(request, socket, head, (clientWs) => {
        const upstreamWs = new ws(wsUrl);

        upstreamWs.on('open', () => {
          clientWs.on('message', (data: Buffer | string, isBinary: boolean) => {
            if (upstreamWs.readyState === ws.OPEN) upstreamWs.send(data, { binary: isBinary });
          });
          upstreamWs.on('message', (data: Buffer | string, isBinary: boolean) => {
            if (clientWs.readyState === ws.OPEN) clientWs.send(data, { binary: isBinary });
          });
        });

        const closeOther = (other: ws.WebSocket) => {
          if (other.readyState === ws.OPEN || other.readyState === ws.CLOSING) {
            other.close();
          }
        };
        clientWs.on('close', () => closeOther(upstreamWs));
        clientWs.on('error', () => closeOther(upstreamWs));
        upstreamWs.on('close', () => closeOther(clientWs));
        upstreamWs.on('error', () => closeOther(clientWs));
      });
    });

    this.logger.log(
      `HMR WebSocket proxy: ${HMR_PATH}* -> ${shellBase}, ${HMR_PATH_DIARY}* -> ${diaryBase}, ${HMR_PATH_SETTINGS}* -> ${settingsBase}, ${HMR_PATH_TASKS}* -> ${tasksBase}`,
    );
  }
}
