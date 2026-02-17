import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { AppModule } from '../src/app.module';
import { correlationIdPlugin } from '../src/common/plugins/correlation-id.plugin';
import { headerNormalizationPlugin } from '../src/common/plugins/header-normalization.plugin';
import { securityHeadersPlugin } from '../src/common/plugins/security-headers.plugin';
import { ProxyProvider } from '../src/gateway/proxy.provider';
import { RateLimitProvider } from '../src/gateway/rate-limit.provider';
import { CORRELATION_ID_HEADER } from '../src/common/constants';
import { GatewayErrorResponse } from '../src/common/interfaces';
import { getClientIpForRateLimit } from '../src/common/plugins/header-normalization.plugin';
import { FastifyRequest } from 'fastify';

export interface TestAppOptions {
  bodyLimit?: number;
  trustProxy?: boolean;
  mockProxyProvider?: boolean;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<NestFastifyApplication> {
  const { bodyLimit = 1024, trustProxy = false, mockProxyProvider = false } = options;

  // Get rate limit config from env
  const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);
  const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS || '60', 10) * 1000;

  let moduleBuilder = Test.createTestingModule({
    imports: [AppModule],
  });

  if (mockProxyProvider) {
    moduleBuilder = moduleBuilder
      .overrideProvider(ProxyProvider)
      .useValue({ onModuleInit: () => {} });
  }

  // Always mock rate limit provider in tests as we register it manually
  moduleBuilder = moduleBuilder
    .overrideProvider(RateLimitProvider)
    .useValue({ onModuleInit: () => {}, onModuleDestroy: () => {} });

  const moduleFixture: TestingModule = await moduleBuilder.compile();

  const fastifyAdapter = new FastifyAdapter({
    trustProxy,
    bodyLimit,
  });

  const app = moduleFixture.createNestApplication<NestFastifyApplication>(fastifyAdapter);
  const fastifyInstance = fastifyAdapter.getInstance();

  // Register plugins BEFORE app.init()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (fastifyInstance as any).register(correlationIdPlugin);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (fastifyInstance as any).register(headerNormalizationPlugin, { trustProxy });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (fastifyInstance as any).register(securityHeadersPlugin);

  // Register rate limit plugin before app.init()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (fastifyInstance as any).register(fastifyRateLimit, {
    global: true,
    max: rateLimitMax,
    timeWindow: rateLimitWindowMs,
    keyGenerator: (request: FastifyRequest) => {
      return getClientIpForRateLimit(request, trustProxy);
    },
    errorResponseBuilder: (
      request: FastifyRequest,
      context: { max: number; ttl: number },
    ): GatewayErrorResponse => {
      const correlationId =
        (request.headers[CORRELATION_ID_HEADER] as string) ||
        (request as FastifyRequest & { correlationId?: string }).correlationId ||
        'unknown';
      return {
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Rate limit exceeded. Maximum ${context.max} requests allowed. Try again later.`,
          correlationId,
        },
      };
    },
  });

  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return app;
}
