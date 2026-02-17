import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { AppConfigService, UpstreamConfig } from '../config';
import { CORRELATION_ID_HEADER, HOP_BY_HOP_HEADERS } from '../common/constants';
import { request as undiciRequest, Dispatcher } from 'undici';

@Injectable()
export class ProxyProvider implements OnModuleInit {
  private readonly logger = new Logger(ProxyProvider.name);

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly configService: AppConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const fastify = this.adapterHost.httpAdapter.getInstance<FastifyInstance>();
    const upstreamConfigs = this.configService.upstreamConfigs;

    for (const config of upstreamConfigs) {
      await this.registerProxy(fastify, config);
    }

    this.logger.log(`Registered ${upstreamConfigs.length} proxy routes`);
  }

  private async registerProxy(fastify: FastifyInstance, config: UpstreamConfig): Promise<void> {
    const { prefix, upstream, rewritePrefix } = config;
    const timeout = this.configService.upstreamTimeoutMs;

    this.logger.log(`Registering proxy: ${prefix}/* -> ${upstream}${rewritePrefix || prefix}/*`);

    // Use manual proxy implementation to avoid content type parser conflicts
    fastify.all(`${prefix}/*`, async (request: FastifyRequest, reply) => {
      const path = request.url.replace(prefix, rewritePrefix || prefix);
      const upstreamUrl = new URL(path, upstream);

      // Build headers - filter out hop-by-hop headers
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        const lowerKey = key.toLowerCase();
        // Skip hop-by-hop headers
        if (HOP_BY_HOP_HEADERS.includes(lowerKey)) {
          continue;
        }
        if (value) {
          headers[key] = Array.isArray(value) ? value[0] : value;
        }
      }

      // Add correlation ID
      if (request.correlationId) {
        headers[CORRELATION_ID_HEADER] = request.correlationId;
      }

      // Set correct Host header
      const upstreamHost = new URL(upstream);
      headers['host'] = upstreamHost.host;

      // Prepare body - handle different body types
      let body: string | Buffer | undefined;
      if (request.body) {
        if (Buffer.isBuffer(request.body)) {
          body = request.body;
        } else if (typeof request.body === 'string') {
          body = request.body;
        } else if (typeof request.body === 'object') {
          body = JSON.stringify(request.body);
        }
      }

      try {
        const response = await undiciRequest(upstreamUrl.toString(), {
          method: request.method as Dispatcher.HttpMethod,
          headers,
          body,
          headersTimeout: timeout,
          bodyTimeout: timeout,
        });

        // Forward response headers - filter out hop-by-hop
        for (const [key, value] of Object.entries(response.headers)) {
          const lowerKey = key.toLowerCase();
          if (value && !HOP_BY_HOP_HEADERS.includes(lowerKey)) {
            reply.header(key, value);
          }
        }

        reply.status(response.statusCode);
        return reply.send(response.body);
      } catch (error) {
        this.logger.error(
          {
            correlationId: request.correlationId,
            upstream: upstreamUrl.toString(),
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          'Upstream request failed',
        );

        return reply.status(502).send({
          error: {
            code: 'UPSTREAM_ERROR',
            message: 'Upstream service unavailable',
            correlationId: request.correlationId || 'unknown',
          },
        });
      }
    });
  }
}
