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

  // Upstream URLs
  AUTH_UPSTREAM_URL: z.string().url().optional(),
  DIARY_UPSTREAM_URL: z.string().url().optional(),
  TASKS_UPSTREAM_URL: z.string().url().optional(),
  HEALTH_UPSTREAM_URL: z.string().url().optional(),

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
