import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ProxyProvider } from './proxy.provider';
import { RateLimitProvider } from './rate-limit.provider';

@Module({
  controllers: [HealthController],
  providers: [ProxyProvider, RateLimitProvider],
})
export class GatewayModule {}
