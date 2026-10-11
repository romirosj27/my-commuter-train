import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  WORKER_HEALTH_PORT: z.coerce.number().int().default(8081),
  /** How far ahead and behind "now" a resync snapshot covers. */
  RESYNC_BEHIND_MIN: z.coerce.number().int().default(120),
  RESYNC_AHEAD_MIN: z.coerce.number().int().default(12 * 60),
  INCIDENTS_POLL_SEC: z.coerce.number().int().min(15).default(120),
  ALERT_SWEEP_SEC: z.coerce.number().int().min(30).default(300),
  /** Public URLs used for links in alert emails. */
  WEB_URL: z.string().url().default('http://localhost:5173'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  EMAIL_TRANSPORT: z.enum(['console', 'resend']).default('console'),
  EMAIL_FROM: z.string().default('My Commuter Train <alerts@localhost>'),
  RESEND_API_KEY: z.string().optional(),
});

export type WorkerEnv = z.infer<typeof schema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid worker environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
