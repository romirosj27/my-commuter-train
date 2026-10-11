import type { DarwinEvent, NetworkEvent } from '@mct/shared';
import type { EmailJob } from '../alerts/engine.ts';
import { Queue, type ConnectionOptions } from 'bullmq';

export const QUEUES = {
  /** Feed events in arrival order (processed with concurrency 1). */
  ingest: 'ingest',
  /** Scheduled housekeeping: incidents poll, reference refresh, purge. */
  maintenance: 'maintenance',
  /** Services to evaluate for alerts. */
  alerts: 'alerts',
  /** Alert emails to send (retried on failure). */
  email: 'email',
} as const;

export type IngestJob = { source: 'darwin'; event: DarwinEvent } | { source: 'network'; event: NetworkEvent };
export type MaintenanceJob = { task: 'incidents' | 'reference' | 'purge' | 'alerts-sweep' };
export interface AlertJob {
  serviceId: string;
}

export function redisConnection(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

export const defaultJobOptions = {
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
} as const;

export function createQueues(connection: ConnectionOptions) {
  return {
    ingest: new Queue<IngestJob>(QUEUES.ingest, { connection, defaultJobOptions }),
    maintenance: new Queue<MaintenanceJob>(QUEUES.maintenance, { connection, defaultJobOptions }),
    alerts: new Queue<AlertJob>(QUEUES.alerts, { connection, defaultJobOptions }),
    email: new Queue<EmailJob>(QUEUES.email, {
      connection,
      defaultJobOptions: { ...defaultJobOptions, attempts: 6, backoff: { type: 'exponential', delay: 5000 } },
    }),
  };
}
export type Queues = ReturnType<typeof createQueues>;
