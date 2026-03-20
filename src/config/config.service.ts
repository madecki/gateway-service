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

  get authUpstreamUrl(): string {
    const url = this.configService.get('AUTH_UPSTREAM_URL');
    if (!url) throw new Error('AUTH_UPSTREAM_URL is required');
    return url;
  }

  get authJwksUrl(): string {
    const explicit = this.configService.get('AUTH_JWKS_URL');
    if (explicit) return explicit;
    return `${this.authUpstreamUrl}/.well-known/jwks.json`;
  }

  get diaryServiceToken(): string {
    return this.configService.get('DIARY_SERVICE_TOKEN');
  }

  get shellUpstreamUrl(): string {
    return this.configService.get('SHELL_UPSTREAM_URL');
  }

  get diaryAppUpstreamUrl(): string {
    return this.configService.get('DIARY_APP_UPSTREAM_URL');
  }

  /** API upstreams for the generic proxy (auth is handled by AuthCookieProvider). */
  get upstreamConfigs(): UpstreamConfig[] {
    const configs: UpstreamConfig[] = [];

    const diaryUrl = this.configService.get('DIARY_UPSTREAM_URL');
    if (diaryUrl) {
      // /diary/entries → /entries at diary-api
      configs.push({ prefix: '/diary', upstream: diaryUrl, rewritePrefix: '' });
    }

    const tasksUrl = this.configService.get('TASKS_UPSTREAM_URL');
    if (tasksUrl) {
      configs.push({ prefix: '/tasks', upstream: tasksUrl, rewritePrefix: '' });
    }

    return configs;
  }
}
