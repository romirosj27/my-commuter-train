import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().default(8080),
  /** Public URL of this API, used in auth email links. */
  API_PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  /** Public URL of the web app (CORS origin; auth redirects must point here). */
  WEB_URL: z.string().url().default('http://localhost:5173'),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(30),
  EMAIL_TRANSPORT: z.enum(['console', 'resend']).default('console'),
  EMAIL_FROM: z.string().default('My Commuter Train <alerts@localhost>'),
  RESEND_API_KEY: z.string().optional(),
  /** JSON overrides for prediction thresholds (see packages/shared/src/prediction). */
  PREDICTION_CONFIG: z.string().optional(),
  /** Comma-separated emails of users who may edit Delay Repay schemes. */
  ADMIN_EMAILS: z.string().default(''),
});

export type ApiEnv = z.infer<typeof schema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid API environment:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
