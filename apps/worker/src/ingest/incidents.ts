import { incidents, type Db } from '@mct/db';
import type { IncidentsFeed } from '@mct/shared';
import { and, gt, isNull, notInArray, sql } from 'drizzle-orm';

/**
 * Upserts active incidents and closes any open incident the feed no longer lists.
 * Returns the number of active incidents.
 */
export async function syncIncidents(db: Db, feed: IncidentsFeed, now: Date): Promise<number> {
  const active = await feed.fetchActive(now);
  await db.transaction(async (tx) => {
    if (active.length) {
      await tx
        .insert(incidents)
        .values(
          active.map((i) => ({
            feedId: i.feedId,
            summary: i.summary,
            description: i.description,
            startsAt: new Date(i.startsAt),
            endsAt: i.endsAt ? new Date(i.endsAt) : null,
            affectedCrs: i.affectedCrs,
            operatorCodes: i.operatorCodes,
            updatedAt: new Date(i.updatedAt),
          })),
        )
        .onConflictDoUpdate({
          target: incidents.feedId,
          set: {
            summary: sql`excluded.summary`,
            description: sql`excluded.description`,
            startsAt: sql`excluded.starts_at`,
            endsAt: sql`excluded.ends_at`,
            affectedCrs: sql`excluded.affected_crs`,
            operatorCodes: sql`excluded.operator_codes`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
    const ids = active.map((i) => i.feedId);
    await tx
      .update(incidents)
      .set({ endsAt: now })
      .where(and(isNull(incidents.endsAt), ids.length ? notInArray(incidents.feedId, ids) : undefined));
    // Incidents with a future end that have dropped off the feed are closed too.
    await tx
      .update(incidents)
      .set({ endsAt: now })
      .where(and(gt(incidents.endsAt, now), ids.length ? notInArray(incidents.feedId, ids) : undefined));
  });
  return active.length;
}
