import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().default(8080),
  /** Comma-separated origins allowed by CORS (the web app). */
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(300),
});

export type ApiEnv = z.infer<typeof schema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid API environment:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
