import type { Operator, Station, Tiploc } from '@mct/shared';
import { sql } from 'drizzle-orm';
import { toSearchName, type Db } from './index.ts';
import { operators, stations, tiplocs } from './schema.ts';

/** Upserts reference data. Used by the seed and by the worker's reference refresh. */
export async function upsertReferenceData(
  db: Db,
  data: { stations: Station[]; tiplocs: Tiploc[]; operators: Operator[] },
): Promise<void> {
  await db.transaction(async (tx) => {
    if (data.stations.length) {
      await tx
        .insert(stations)
        .values(data.stations.map((s) => ({ ...s, searchName: toSearchName(s.name) })))
        .onConflictDoUpdate({
          target: stations.crs,
          set: {
            name: sql`excluded.name`,
            searchName: sql`excluded.search_name`,
            lat: sql`excluded.lat`,
            lon: sql`excluded.lon`,
            updatedAt: sql`now()`,
          },
        });
    }
    if (data.tiplocs.length) {
      await tx
        .insert(tiplocs)
        .values(data.tiplocs)
        .onConflictDoUpdate({
          target: tiplocs.tiploc,
          set: { crs: sql`excluded.crs`, name: sql`excluded.name`, updatedAt: sql`now()` },
        });
    }
    if (data.operators.length) {
      await tx
        .insert(operators)
        .values(data.operators)
        .onConflictDoUpdate({
          target: operators.code,
          set: { name: sql`excluded.name`, claimUrl: sql`coalesce(excluded.claim_url, operators.claim_url)`, updatedAt: sql`now()` },
        });
    }
  });
}
