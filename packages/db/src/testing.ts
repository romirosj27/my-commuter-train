/** Test helpers: reset a throwaway database to a freshly migrated, seeded state. */
import { createDb, type DbHandle } from './index.ts';
import { runMigrations } from './migrate.ts';
import { seed } from './seed.ts';

export async function freshTestDb(url: string): Promise<DbHandle> {
  const admin = createDb(url, { max: 1 });
  try {
    await admin.sql`drop schema if exists public cascade`;
    await admin.sql`drop schema if exists drizzle cascade`;
    await admin.sql`create schema public`;
  } finally {
    await admin.close();
  }
  await runMigrations(url);
  const h = createDb(url, { max: 4 });
  await seed(h.db);
  return h;
}
