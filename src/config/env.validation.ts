import { z } from 'zod';

const DURATION = /^\d+(ms|s|m|h|d|w|y)$/;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // Separate secrets, so a leaked access-token secret cannot be used to mint
  // refresh tokens (which live far longer).
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  // Constrained to the `ms` format jsonwebtoken accepts (e.g. 15m, 7d, 3600s).
  // A typo like "15min" would otherwise be caught only when a token is signed.
  JWT_ACCESS_TTL: z
    .string()
    .regex(DURATION, 'must be a duration like 15m, 3600s, or 7d')
    .default('15m'),
  JWT_REFRESH_TTL: z
    .string()
    .regex(DURATION, 'must be a duration like 15m, 3600s, or 7d')
    .default('7d'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Fail fast on boot rather than at the first query: a missing DATABASE_URL
 * should crash startup, not surface as a confusing runtime error later.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${details}`);
  }

  return parsed.data;
}
