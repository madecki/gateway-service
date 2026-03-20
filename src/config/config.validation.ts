import { z } from 'zod';

export const envSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  TRUST_PROXY: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),

  // Request limits
  REQUEST_BODY_LIMIT_BYTES: z.coerce.number().default(1048576),

  // Upstream API URLs
  AUTH_UPSTREAM_URL: z.string().url().optional(),
  DIARY_UPSTREAM_URL: z.string().url().optional(),
  TASKS_UPSTREAM_URL: z.string().url().optional(),

  // Frontend upstream URLs (Next.js dev servers)
  SHELL_UPSTREAM_URL: z.string().url().default('http://localhost:3001'),
  DIARY_APP_UPSTREAM_URL: z.string().url().default('http://localhost:4280'),

  // Upstream timeout
  UPSTREAM_TIMEOUT_MS: z.coerce.number().default(30000),

  // Global rate limiting
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().default(60),

  // Auth rate limiting (stricter)
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(5),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().default(60),

  // Logging
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // JWKS URL for verifying access tokens — defaults to AUTH_UPSTREAM_URL + /.well-known/jwks.json
  AUTH_JWKS_URL: z.string().url().optional(),

  // Shared secret between gateway and diary-api — REQUIRED for service-to-service trust.
  // Set the same value in both DIARY_SERVICE_TOKEN (gateway) and GATEWAY_SERVICE_TOKEN (diary-api).
  DIARY_SERVICE_TOKEN: z.string().min(32, 'DIARY_SERVICE_TOKEN must be at least 32 characters'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const errorMessages = result.error.errors
      .map((err) => `${err.path.join('.')}: ${err.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${errorMessages}`);
  }

  return result.data;
}
