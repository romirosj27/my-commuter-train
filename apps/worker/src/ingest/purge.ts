import { associations, incidents, networkEvents, services, type Db } from '@mct/db';
import { addDays, toLondon } from '@mct/shared';
import { and, lt, notExists, sql } from '@mct/db/orm';

export interface PurgeConfig {
  /** Keep services whose start date is within this many days before today (London). */
  serviceDays: number;
  networkEventHours: number;
  incidentDays: number;
}

export const DEFAULT_PURGE: PurgeConfig = { serviceDays: 2, networkEventHours: 6, incidentDays: 2 };

/**
 * Removes stale live data. Journeys keep their own copy of times, and their
 * `service_id` is set null by the foreign key, so purging never loses a user's log.
 */
export async function purge(db: Db, now: Date, cfg: PurgeConfig = DEFAULT_PURGE) {
  const cutoffDate = addDays(toLondon(now).date, -cfg.serviceDays);
  const svc = await db.delete(services).where(lt(services.ssd, cutoffDate)).returning({ id: services.id });
  const assoc = await db
    .delete(associations)
    .where(
      and(
        notExists(db.select({ one: sql`1` }).from(services).where(sql`${services.feedId} = ${associations.mainFeedId}`)),
        notExists(db.select({ one: sql`1` }).from(services).where(sql`${services.feedId} = ${associations.assocFeedId}`)),
      ),
    )
    .returning({ k: associations.mainFeedId });
  const ne = await db
    .delete(networkEvents)
    .where(lt(networkEvents.observedAt, new Date(now.getTime() - cfg.networkEventHours * 3600_000)))
    .returning({ id: networkEvents.id });
  const inc = await db
    .delete(incidents)
    .where(lt(incidents.endsAt, new Date(now.getTime() - cfg.incidentDays * 86_400_000)))
    .returning({ id: incidents.id });
  return { services: svc.length, associations: assoc.length, networkEvents: ne.length, incidents: inc.length };
}
