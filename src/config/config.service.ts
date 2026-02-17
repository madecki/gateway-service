import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { EnvConfig } from './config.validation';

export interface UpstreamConfig {
  prefix: string;
  upstream: string;
  rewritePrefix?: string;
}

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: NestConfigService<EnvConfig, true>) {}

  get port(): number {
    return this.configService.get('PORT');
  }

  get nodeEnv(): string {
    return this.configService.get('NODE_ENV');
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isTest(): boolean {
    return this.nodeEnv === 'test';
  }

  get trustProxy(): boolean {
    return this.configService.get('TRUST_PROXY');
  }

  get requestBodyLimitBytes(): number {
    return this.configService.get('REQUEST_BODY_LIMIT_BYTES');
  }

  get upstreamTimeoutMs(): number {
    return this.configService.get('UPSTREAM_TIMEOUT_MS');
  }

  get rateLimitMax(): number {
    return this.configService.get('RATE_LIMIT_MAX');
  }

  get rateLimitWindowSeconds(): number {
    return this.configService.get('RATE_LIMIT_WINDOW_SECONDS');
  }

  get authRateLimitMax(): number {
    return this.configService.get('AUTH_RATE_LIMIT_MAX');
  }

  get authRateLimitWindowSeconds(): number {
    return this.configService.get('AUTH_RATE_LIMIT_WINDOW_SECONDS');
  }

  get logLevel(): string {
    return this.configService.get('LOG_LEVEL');
  }

  get upstreamConfigs(): UpstreamConfig[] {
    const configs: UpstreamConfig[] = [];

    const authUrl = this.configService.get('AUTH_UPSTREAM_URL');
    if (authUrl) {
      configs.push({
        prefix: '/auth',
        upstream: authUrl,
        rewritePrefix: '/auth',
      });
    }

    const diaryUrl = this.configService.get('DIARY_UPSTREAM_URL');
    if (diaryUrl) {
      configs.push({
        prefix: '/diary',
        upstream: diaryUrl,
        rewritePrefix: '/diary',
      });
    }

    const tasksUrl = this.configService.get('TASKS_UPSTREAM_URL');
    if (tasksUrl) {
      configs.push({
        prefix: '/tasks',
        upstream: tasksUrl,
        rewritePrefix: '/tasks',
      });
    }

    const healthUpstreamUrl = this.configService.get('HEALTH_UPSTREAM_URL');
    if (healthUpstreamUrl) {
      configs.push({
        prefix: '/upstream-health',
        upstream: healthUpstreamUrl,
        rewritePrefix: '/health',
      });
    }

    return configs;
  }
}
