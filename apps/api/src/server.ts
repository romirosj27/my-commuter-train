import { createDb } from '@mct/db';
import { Redis } from 'ioredis';
import { buildApp } from './app.ts';
import { loadEnv } from './env.ts';

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const redis = env.REDIS_URL ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 }) : undefined;
const pretty = env.NODE_ENV === 'development' && process.stdout.isTTY;

const app = await buildApp({
  db,
  redis,
  webOrigins: env.WEB_ORIGIN.split(',').map((s) => s.trim()),
  rateLimitPerMin: env.RATE_LIMIT_PER_MIN,
  logger: {
    level: env.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    ...(pretty ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
  },
});

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
