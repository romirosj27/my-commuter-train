/**
 * Seeds reference data and placeholder Delay Repay schemes.
 * Demo users and commutes are added in Phase 3 (they need Better Auth's password hashing).
 */
import { demoOperators, demoStations, demoTiplocs } from '@mct/shared';
import { createDb, type Db } from './index.ts';
import { upsertReferenceData } from './reference.ts';
import { delayRepaySchemes, type DelayRepayBand } from './schema.ts';

/**
 * PLACEHOLDER bands — not taken from any operator's published terms. Every
 * scheme seeded with these has verifiedOn = null so the UI flags it. Replace
 * per operator after checking their current Delay Repay terms.
 */
export const PLACEHOLDER_BANDS: DelayRepayBand[] = [
  { minMinutes: 15, maxMinutes: 30, singlePct: 25, returnPct: 12.5 },
  { minMinutes: 30, maxMinutes: 60, singlePct: 50, returnPct: 25 },
  { minMinutes: 60, maxMinutes: 120, singlePct: 100, returnPct: 50 },
  { minMinutes: 120, maxMinutes: null, singlePct: 100, returnPct: 100 },
];

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
