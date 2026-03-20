import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfigService } from './config';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { correlationIdPlugin } from './common/plugins/correlation-id.plugin';
import { headerNormalizationPlugin } from './common/plugins/header-normalization.plugin';
import { securityHeadersPlugin } from './common/plugins/security-headers.plugin';

async function bootstrap(): Promise<void> {
  // Create Fastify adapter with initial options
  const fastifyAdapter = new FastifyAdapter({
    trustProxy: process.env.TRUST_PROXY === 'true',
    bodyLimit: parseInt(process.env.REQUEST_BODY_LIMIT_BYTES || '1048576', 10),
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, fastifyAdapter, {
    bufferLogs: true,
  });

  // Get config service
  const configService = app.get(AppConfigService);

  // Use Pino logger
  app.useLogger(app.get(Logger));

  // Get Fastify instance and register plugins
  const fastify = app.getHttpAdapter().getInstance();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (fastify as any).register(require('@fastify/cookie'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (fastify as any).register(correlationIdPlugin);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (fastify as any).register(headerNormalizationPlugin, {
    trustProxy: configService.trustProxy,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (fastify as any).register(securityHeadersPlugin);

  // Global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Enable CORS for development
  if (configService.isDevelopment) {
    app.enableCors({
      origin: true,
      credentials: true,
    });
  }

  // Start server
  const port = configService.port;
  await app.listen(port, '0.0.0.0');

  const logger = app.get(Logger);
  logger.log(`Gateway service started on port ${port}`);
  logger.log(`Environment: ${configService.nodeEnv}`);
  logger.log(`Trust proxy: ${configService.trustProxy}`);
  logger.log(`Request body limit: ${configService.requestBodyLimitBytes} bytes`);
  logger.log(`Upstream timeout: ${configService.upstreamTimeoutMs}ms`);
  logger.log(`Configured upstreams: ${configService.upstreamConfigs.length}`);

  for (const upstream of configService.upstreamConfigs) {
    logger.log(`  ${upstream.prefix}/* -> ${upstream.upstream}${upstream.rewritePrefix}/*`);
  }
}

bootstrap();
