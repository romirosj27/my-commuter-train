/**
 * Seeds reference data and placeholder Delay Repay schemes.
 * Demo users and commutes are added in Phase 3 (they need Better Auth's password hashing).
 */
import { demoOperators, demoStations, demoTiplocs, PLACEHOLDER_BANDS } from '@mct/shared';
import { createDb, type Db } from './index.ts';
import { upsertReferenceData } from './reference.ts';
import { delayRepaySchemes } from './schema.ts';

export async function seed(db: Db): Promise<void> {
  await upsertReferenceData(db, { stations: demoStations, tiplocs: demoTiplocs, operators: demoOperators });
  await db
    .insert(delayRepaySchemes)
    .values(
      demoOperators.map((op) => ({
        toc: op.code,
        name: `${op.name} Delay Repay (placeholder)`,
        bands: PLACEHOLDER_BANDS,
        claimUrl: op.claimUrl,
        notes: 'Placeholder bands. Check the operator’s current Delay Repay terms before relying on this.',
        verifiedOn: null,
      })),
    )
    .onConflictDoNothing({ target: delayRepaySchemes.toc });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const handle = createDb();
  try {
    await seed(handle.db);
    console.log('seed complete');
  } finally {
    await handle.close();
  }
}

export { PLACEHOLDER_BANDS };
