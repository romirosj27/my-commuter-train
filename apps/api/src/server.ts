import { createDb } from '@mct/db';
import { createTransport } from '@mct/email';
import { predictionConfigFromJson, redisOptionsFromUrl } from '@mct/shared';
import { Redis } from 'ioredis';
import { buildApp } from './app.ts';
import { loadEnv } from './env.ts';

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const redis = env.REDIS_URL ? new Redis({ ...redisOptionsFromUrl(env.REDIS_URL), maxRetriesPerRequest: 2 }) : undefined;
const pretty = env.NODE_ENV === 'development' && process.stdout.isTTY;

const app = await buildApp({
  db,
  redis,
  email: createTransport(env),
  authSecret: env.BETTER_AUTH_SECRET,
  apiURL: env.API_PUBLIC_URL,
  webURL: env.WEB_URL,
  rateLimitPerMin: env.RATE_LIMIT_PER_MIN,
  authRateLimitPerMin: env.AUTH_RATE_LIMIT_PER_MIN,
  predictionConfig: predictionConfigFromJson(env.PREDICTION_CONFIG),
  adminEmails: env.ADMIN_EMAILS.split(','),
  cookieDomain: env.COOKIE_DOMAIN || undefined,
  logger: {
    level: env.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    ...(pretty ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
  },
});

redis?.on('error', (err) => app.log.warn({ err: err.message }, 'redis error'));

await app.listen({ host: env.API_HOST, port: env.API_PORT });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    redis?.disconnect();
    await db.close();
    process.exit(0);
  });
}
