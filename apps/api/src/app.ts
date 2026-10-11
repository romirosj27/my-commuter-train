import type { Db, DbHandle } from '@mct/db';
import type { EmailTransport } from '@mct/email';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Redis } from 'ioredis';
import { createAuth, type Auth } from './auth.ts';
import { HttpError } from './lib/http.ts';
import { authPlugin } from './plugins/auth.ts';
import { commuteRoutes } from './routes/commutes.ts';
import { meRoutes } from './routes/me.ts';
import { unsubscribeRoutes } from './routes/unsubscribe.ts';
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
  auth: Auth;
  email: EmailTransport;
}

export interface AppOptions {
  db: DbHandle;
  redis?: Redis;
  now?: () => Date;
  logger?: FastifyServerOptions['logger'];
  email: EmailTransport;
  authSecret: string;
  /** Public URL of this API. */
  apiURL: string;
  /** Public URL of the web app (CORS origin and email link target). */
  webURL: string;
  rateLimitPerMin?: number;
  authRateLimitPerMin?: number;
  /** Better Auth's internal per-endpoint limiter (disable in tests). */
  authInternalRateLimit?: boolean;
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
    email: opts.email,
    auth: createAuth({
      db: opts.db.db,
      email: opts.email,
      secret: opts.authSecret,
      baseURL: opts.apiURL,
      webURL: opts.webURL,
      trustedOrigins: [],
      rateLimit: opts.authInternalRateLimit ?? true,
    }),
  };

  await app.register(cors, {
    origin: [opts.webURL],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  await app.register(rateLimit, {
    global: true,
    max: opts.rateLimitPerMin ?? 300,
    timeWindow: '1 minute',
    // If Redis is unavailable, serve requests rather than fail them.
    skipOnError: true,
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

  await authPlugin(app, deps.auth, opts.authRateLimitPerMin ?? 30);
  await healthRoutes(app, deps);
  await referenceRoutes(app, deps);
  await boardRoutes(app, deps);
  await commuteRoutes(app, deps);
  await meRoutes(app, deps);
  await unsubscribeRoutes(app, { ...deps, webURL: opts.webURL });
  return app;
}
