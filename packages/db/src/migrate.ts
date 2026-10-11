import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './index.ts';

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

export async function runMigrations(url?: string): Promise<void> {
  const handle = createDb(url, { max: 1 });
  try {
    // Extensions are created here rather than in generated migrations.
    await handle.sql`create extension if not exists pg_trgm`;
    await migrate(handle.db, { migrationsFolder });
  } finally {
    await handle.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMigrations();
  console.log('migrations applied');
}
