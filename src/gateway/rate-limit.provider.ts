import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { AppConfigService } from '../config';
import { AUTH_RATE_LIMIT_ROUTES, CORRELATION_ID_HEADER } from '../common/constants';
import { GatewayErrorResponse } from '../common/interfaces';
import { getClientIpForRateLimit } from '../common/plugins/header-normalization.plugin';

@Injectable()
export class RateLimitProvider implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RateLimitProvider.name);
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private authRateLimitState = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly configService: AppConfigService,
  ) {}

  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  async onModuleInit(): Promise<void> {
    const fastify = this.adapterHost.httpAdapter.getInstance<FastifyInstance>();

    const globalMax = this.configService.rateLimitMax;
    const globalWindowMs = this.configService.rateLimitWindowSeconds * 1000;
    const authMax = this.configService.authRateLimitMax;
    const authWindowMs = this.configService.authRateLimitWindowSeconds * 1000;
    const trustProxy = this.configService.trustProxy;

    // Register global rate limit
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (fastify as any).register(fastifyRateLimit, {
      global: true,
      max: globalMax,
      timeWindow: globalWindowMs,
      keyGenerator: (request: FastifyRequest) => {
        return getClientIpForRateLimit(request, trustProxy);
      },
      errorResponseBuilder: (
        request: FastifyRequest,
        context: { max: number; ttl: number },
      ): GatewayErrorResponse => {
        const correlationId =
          (request.headers[CORRELATION_ID_HEADER] as string) || request.correlationId || 'unknown';
        return {
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Rate limit exceeded. Maximum ${context.max} requests allowed. Try again later.`,
            correlationId,
          },
        };
      },
    });

    this.logger.log(
      `Global rate limit configured: ${globalMax} requests per ${this.configService.rateLimitWindowSeconds}s`,
    );

    // Add a preHandler hook for auth routes with stricter limits
    fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
      const isAuthRoute = AUTH_RATE_LIMIT_ROUTES.some(
        (route) => request.method === route.method && request.url.startsWith(route.url),
      );

      if (!isAuthRoute) {
        return;
      }

      const clientIp = getClientIpForRateLimit(request, trustProxy);
      const key = `auth:${clientIp}:${request.url}`;
      const now = Date.now();

      let state = this.authRateLimitState.get(key);

      if (!state || now > state.resetAt) {
        state = { count: 0, resetAt: now + authWindowMs };
        this.authRateLimitState.set(key, state);
      }

      state.count++;

      if (state.count > authMax) {
        const correlationId = request.correlationId || 'unknown';
        const response: GatewayErrorResponse = {
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Auth rate limit exceeded. Maximum ${authMax} requests allowed. Try again later.`,
            correlationId,
          },
        };

        reply.status(429).send(response);
        return;
      }
    });

    this.logger.log(
      `Auth rate limit configured: ${authMax} requests per ${this.configService.authRateLimitWindowSeconds}s`,
    );

    // Clean up expired entries periodically - use unref to not block process exit
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, state] of this.authRateLimitState.entries()) {
        if (now > state.resetAt) {
          this.authRateLimitState.delete(key);
        }
      }
    }, 60 * 1000);

    // Ensure interval doesn't prevent process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }
}
