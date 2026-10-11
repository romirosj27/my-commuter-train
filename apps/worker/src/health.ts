import { createServer, type Server } from 'node:http';
import type { FeedHealth } from '@mct/shared';

export interface HealthSources {
  feeds: () => FeedHealth[];
  checks: Record<string, () => Promise<void>>;
  extra?: () => Promise<Record<string, unknown>>;
}

export async function healthReport(src: HealthSources) {
  const checks: Record<string, 'ok' | string> = {};
  await Promise.all(
    Object.entries(src.checks).map(async ([name, check]) => {
      try {
        await check();
        checks[name] = 'ok';
      } catch (err) {
        checks[name] = err instanceof Error ? err.message : String(err);
      }
    }),
  );
  const feeds = src.feeds();
  const depsOk = Object.values(checks).every((v) => v === 'ok');
  const feedsOk = feeds.every((f) => f.connected);
  return {
    status: !depsOk ? 'down' : feedsOk ? 'ok' : 'degraded',
    checks,
    feeds,
    ...(src.extra ? await src.extra() : {}),
  } as const;
}

/** GET /health: 200 while the database and Redis are reachable (feeds may be reconnecting), else 503. */
export function startHealthServer(port: number, src: HealthSources): Server {
  const server = createServer(async (req, res) => {
    if (req.method !== 'GET' || req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    const report = await healthReport(src);
    res.writeHead(report.status === 'down' ? 503 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(report));
  });
  server.listen(port);
  return server;
}
