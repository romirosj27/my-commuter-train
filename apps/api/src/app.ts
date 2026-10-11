import type { Db, DbHandle } from '@mct/db';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Redis } from 'ioredis';
import { HttpError } from './lib/http.ts';
import { boardRoutes } from './routes/board.ts';
import { healthRoutes } from './routes/health.ts';
import { referenceRoutes } from './routes/reference.ts';
import { ReferenceCache } from './services/reference.ts';

export interface AppDeps {
  db: Db;
  sql: DbHandle['sql'];
  redis?: Redis;
  ref: ReferenceCache;
  /** Current time (overridable so tests and mock mode can pin the clock). */
  now: () => Date;
}

export interface AppOptions {
  db: DbHandle;
  redis?: Redis;
  now?: () => Date;
  logger?: FastifyServerOptions['logger'];
  webOrigins?: string[];
  rateLimitPerMin?: number;
}

export async function buildApp(opts: AppOptions) {
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: true,
    // Request ids in logs, not user data.
    genReqId: () => crypto.randomUUID(),
  });

  const deps: AppDeps = {
    db: opts.db.db,
    sql: opts.db.sql,
    redis: opts.redis,
    ref: new ReferenceCache(opts.db.db),
    now: opts.now ?? (() => new Date()),
  };

  await app.register(cors, { origin: opts.webOrigins ?? true, credentials: true });
  await app.register(rateLimit, {
    global: true,
    max: opts.rateLimitPerMin ?? 300,
    timeWindow: '1 minute',
    ...(opts.redis ? { redis: opts.redis, nameSpace: 'mct-rl:' } : {}),
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.message, details: err.details });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error({ err }, 'request failed');
    return reply.code(500).send({ error: 'Internal server error' });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Not found' }));

  await healthRoutes(app, deps);
  await referenceRoutes(app, deps);
  await boardRoutes(app, deps);
  return app;
}
