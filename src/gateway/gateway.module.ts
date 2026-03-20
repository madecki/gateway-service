import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { AuthCookieProvider } from './auth-cookie.provider';
import { FrontendProvider } from './frontend.provider';
import { ProxyProvider } from './proxy.provider';
import { RateLimitProvider } from './rate-limit.provider';
import { JwtVerifierService } from './jwt-verifier.service';

// Registration order matters: OnModuleInit hooks run in this order.
// AuthCookieProvider and FrontendProvider must register their Fastify routes
// BEFORE ProxyProvider registers the /auth/* wildcard and the /* catch-all in
// FrontendProvider — more specific Fastify routes always win regardless of
// registration order, but we keep explicit ordering for clarity.
@Module({
  controllers: [HealthController],
  providers: [
    JwtVerifierService,
    AuthCookieProvider,  // exact auth routes (/auth/v1/auth/login etc.)
    ProxyProvider,       // /diary/*, /auth/*, /tasks/* wildcards
    FrontendProvider,    // /app/diary/* and /* catch-all (registered last)
    RateLimitProvider,
  ],
})
export class GatewayModule {}
