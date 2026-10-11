import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.ts';

export async function healthRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get('/health', { config: { rateLimit: false } }, async (_req, reply) => {
    const checks: Record<string, string> = {};
    try {
      await deps.sql`select 1`;
      checks.database = 'ok';
    } catch (err) {
      checks.database = err instanceof Error ? err.message : String(err);
    }
    if (deps.redis) {
      try {
        await deps.redis.ping();
        checks.redis = 'ok';
      } catch (err) {
        checks.redis = err instanceof Error ? err.message : String(err);
      }
    }
    const ok = Object.values(checks).every((v) => v === 'ok');
    return reply.code(ok ? 200 : 503).send({ status: ok ? 'ok' : 'down', checks });
  });
}
