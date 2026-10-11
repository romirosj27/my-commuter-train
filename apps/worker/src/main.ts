/**
 * Worker entry point: feed ingest (via a BullMQ queue, in order), scheduled
 * maintenance, and a health endpoint. The alert engine joins in Phase 5.
 */
import { createDb } from '@mct/db';
import { createTransport } from '@mct/email';
import { AlertEngine, type EmailJob } from './alerts/engine.ts';
import { sendAlertEmail } from './alerts/sender.ts';
import { servicesDepartingSoon } from './alerts/sweep.ts';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { loadEnv } from './env.ts';
import { createFeeds } from './feeds/index.ts';
import { FeedSupervisor } from './feeds/supervisor.ts';
import { startHealthServer } from './health.ts';
import { syncIncidents } from './ingest/incidents.ts';
import { purge } from './ingest/purge.ts';
import { refreshReferenceData } from './ingest/reference.ts';
import { createQueues, QUEUES, redisConnection, type AlertJob, type IngestJob, type MaintenanceJob } from './jobs/queues.ts';
import { createLogger } from './lib/logger.ts';
import { IngestPipeline } from './pipeline.ts';

const env = loadEnv();
const log = createLogger(env.LOG_LEVEL);
const { db, sql, close: closeDb } = createDb(env.DATABASE_URL);
const connection = redisConnection(env.REDIS_URL);
const queues = createQueues(connection);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
redis.on('error', (err) => log.warn({ err: err.message }, 'redis error'));
await redis.connect();

const feeds = await createFeeds();
const now = () => feeds.clock.now();
log.info({ scenarios: feeds.scenarios, clock: now().toISOString() }, 'feeds created');

const pipeline = new IngestPipeline(db, now, async (changes) => {
  for (const c of changes) {
    log.debug({ feedId: c.feedId, kinds: c.kinds }, 'service changed');
    await queues.alerts.add('evaluate', { serviceId: c.serviceId });
  }
});

// --- Alerts: evaluate changed services, then send emails (retried). ---
const transport = createTransport(env);
const engine = new AlertEngine({
  db,
  now,
  webURL: env.WEB_URL,
  apiURL: env.API_PUBLIC_URL,
  enqueueEmail: async (job) => void (await queues.email.add('alert', job)),
});
const alertWorker = new Worker<AlertJob>(QUEUES.alerts, (job) => engine.evaluate(job.data.serviceId), { connection, concurrency: 1 });
alertWorker.on('failed', (job, err) => log.error({ err, serviceId: job?.data.serviceId }, 'alert evaluation failed'));
const emailWorker = new Worker<EmailJob>(QUEUES.email, (job) => sendAlertEmail(db, transport, job.data), { connection, concurrency: 4 });
emailWorker.on('completed', (job, id) => log.info({ messageId: id, alerts: job.data.alertIds.length }, 'alert email sent'));
emailWorker.on('failed', (job, err) => log.error({ err, attempts: job?.attemptsMade }, 'alert email failed'));

// --- Ingest: feed callbacks enqueue; one worker applies events in order. ---
feeds.darwin.onEvent(async (event) => {
  await queues.ingest.add('darwin', { source: 'darwin', event });
});
feeds.networkRail.onEvent(async (event) => {
  await queues.ingest.add('network', { source: 'network', event });
});

const ingestWorker = new Worker<IngestJob>(QUEUES.ingest, (job) => pipeline.handle(job.data), {
  connection,
  concurrency: 1,
});
ingestWorker.on('failed', (job, err) => log.error({ err, jobId: job?.id, source: job?.data.source }, 'ingest job failed'));

// --- Maintenance ---
const maintenanceWorker = new Worker<MaintenanceJob>(
  QUEUES.maintenance,
  async (job) => {
    switch (job.data.task) {
      case 'incidents':
        return { active: await syncIncidents(db, feeds.incidents, now()) };
      case 'reference':
        pipeline.watched.invalidate();
        return refreshReferenceData(db, feeds.reference);
      case 'purge':
        return purge(db, now());
      case 'alerts-sweep': {
        const ids = await servicesDepartingSoon(db, now());
        await queues.alerts.addBulk(ids.map((serviceId) => ({ name: 'evaluate', data: { serviceId } })));
        return { services: ids.length };
      }
    }
  },
  { connection, concurrency: 1 },
);
maintenanceWorker.on('completed', (job, result) => log.info({ task: job.data.task, result }, 'maintenance done'));
maintenanceWorker.on('failed', (job, err) => log.error({ err, task: job?.data.task }, 'maintenance failed'));

await queues.maintenance.upsertJobScheduler('incidents', { every: env.INCIDENTS_POLL_SEC * 1000 }, {
  name: 'incidents',
  data: { task: 'incidents' },
});
await queues.maintenance.upsertJobScheduler('alerts-sweep', { every: env.ALERT_SWEEP_SEC * 1000 }, {
  name: 'alerts-sweep',
  data: { task: 'alerts-sweep' },
});
await queues.maintenance.upsertJobScheduler('reference', { pattern: '15 3 * * *', tz: 'Europe/London' }, {
  name: 'reference',
  data: { task: 'reference' },
});
await queues.maintenance.upsertJobScheduler('purge', { pattern: '30 2 * * *', tz: 'Europe/London' }, {
  name: 'purge',
  data: { task: 'purge' },
});
// Make sure reference data exists before services arrive.
await refreshReferenceData(db, feeds.reference).catch((err: unknown) => log.error({ err }, 'initial reference refresh failed'));

// --- Feeds, supervised; each (re)connect resyncs the watched stations. ---
const ac = new AbortController();
const darwinSupervisor = new FeedSupervisor(feeds.darwin, log, {
  onConnect: async (attempt) => {
    if (attempt === 0 && feeds.scenarios.length) return; // the mock replays everything on start
    const crs = [...(await pipeline.watched.get())];
    if (!crs.length) return;
    const t = now().getTime();
    let n = 0;
    for await (const event of feeds.darwin.snapshot(crs, new Date(t - env.RESYNC_BEHIND_MIN * 60_000), new Date(t + env.RESYNC_AHEAD_MIN * 60_000))) {
      await queues.ingest.add('darwin', { source: 'darwin', event });
      n++;
    }
    log.info({ attempt, events: n, stations: crs.length }, 'darwin resync queued');
  },
});
const networkSupervisor = new FeedSupervisor(feeds.networkRail, log);
const running = Promise.all([darwinSupervisor.run(ac.signal), networkSupervisor.run(ac.signal)]);

const health = startHealthServer(env.WORKER_HEALTH_PORT, {
  feeds: () => [darwinSupervisor.health(), networkSupervisor.health()],
  checks: {
    database: async () => void (await sql`select 1`),
    redis: async () => void (await redis.ping()),
  },
  extra: async () => ({
    ingestQueue: await queues.ingest.getJobCounts('waiting', 'active', 'failed'),
    alertQueue: await queues.alerts.getJobCounts('waiting', 'active', 'failed'),
    emailQueue: await queues.email.getJobCounts('waiting', 'active', 'failed'),
  }),
});
log.info({ port: env.WORKER_HEALTH_PORT }, 'worker started');

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, 'shutting down');
  ac.abort();
  health.close();
  await running;
  await Promise.all([ingestWorker.close(), maintenanceWorker.close(), alertWorker.close(), emailWorker.close()]);
  await Promise.all(Object.values(queues).map((q) => q.close()));
  redis.disconnect();
  await closeDb();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
