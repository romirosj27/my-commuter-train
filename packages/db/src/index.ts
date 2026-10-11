import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export { schema };
export * from './schema.ts';

export type Db = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  sql: postgres.Sql;
  close(): Promise<void>;
}

/**
 * Set DATABASE_PREPARE=false when connecting through a transaction-pooling
 * PgBouncer (e.g. Fly.io Managed Postgres's pooled URL), which can't use
 * server-side prepared statements.
 */
export function createDb(url: string = requireEnv('DATABASE_URL'), opts: { max?: number; prepare?: boolean } = {}): DbHandle {
  const prepare = opts.prepare ?? process.env.DATABASE_PREPARE !== 'false';
  const client = postgres(url, { max: opts.max ?? 10, prepare, onnotice: () => {} });
  return {
    db: drizzle(client, { schema, casing: 'snake_case' }),
    sql: client,
    close: () => client.end({ timeout: 5 }),
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/** Lower-case, accent-stripped form used for station search. */
export function toSearchName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export { upsertReferenceData } from './reference.ts';
export { PredictionInputs, type JourneyRef } from './prediction.ts';
