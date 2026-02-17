import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../test-utils';

describe('Rate Limit (e2e)', () => {
  let app: NestFastifyApplication;
  const globalRateLimit = 3; // Use very small limit for testing

  beforeAll(async () => {
    process.env.RATE_LIMIT_MAX = globalRateLimit.toString();
    process.env.RATE_LIMIT_WINDOW_SECONDS = '60';
    process.env.AUTH_RATE_LIMIT_MAX = '2';
    process.env.AUTH_RATE_LIMIT_WINDOW_SECONDS = '60';
    process.env.TRUST_PROXY = 'false';
    // Remove upstream URLs to avoid proxy registration
    delete process.env.AUTH_UPSTREAM_URL;
    delete process.env.DIARY_UPSTREAM_URL;
    delete process.env.TASKS_UPSTREAM_URL;
    delete process.env.HEALTH_UPSTREAM_URL;

    app = await createTestApp({ mockProxyProvider: true });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should allow requests within rate limit', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    // Check rate limit headers are present
    expect(response.headers['x-ratelimit-limit']).toBe(String(globalRateLimit));
  });

  it('should return rate limit response when global rate limit is exceeded', async () => {
    // Create a fresh app for this test to ensure clean rate limit state
    const testApp = await createTestApp({ mockProxyProvider: true });

    try {
      let rateLimitResponse: {
        statusCode: number;
        body: string;
        headers: Record<string, unknown>;
      } | null = null;

      // Make more requests than the limit
      for (let i = 0; i < globalRateLimit + 5; i++) {
        const response = await testApp.inject({
          method: 'GET',
          url: '/health',
        });

        // Rate limit triggered when remaining is 0 and retry-after header is present
        if (response.headers['x-ratelimit-remaining'] === '0' && response.headers['retry-after']) {
          rateLimitResponse = response;
          break;
        }
      }

      expect(rateLimitResponse).not.toBeNull();
      // Verify rate limit headers
      expect(rateLimitResponse!.headers['x-ratelimit-limit']).toBe(String(globalRateLimit));
      expect(rateLimitResponse!.headers['retry-after']).toBeDefined();
    } finally {
      await testApp.close();
    }
  });

  it('should include correlation ID in rate limit error response', async () => {
    // Create a fresh app for this test
    const testApp = await createTestApp({ mockProxyProvider: true });

    try {
      const correlationId = `test-rate-limit-correlation-${Date.now()}`;

      // Make requests until rate limit is hit
      for (let i = 0; i < globalRateLimit + 10; i++) {
        const response = await testApp.inject({
          method: 'GET',
          url: '/health',
          headers: {
            'x-correlation-id': correlationId,
          },
        });

        // Check if rate limited (remaining=0 and retry-after present)
        if (response.headers['x-ratelimit-remaining'] === '0' && response.headers['retry-after']) {
          // Verify correlation ID is in response headers
          expect(response.headers['x-correlation-id']).toBe(correlationId);
          return;
        }
      }

      // If we get here, rate limiting wasn't triggered
      expect(true).toBe(false);
    } finally {
      await testApp.close();
    }
  });
});
