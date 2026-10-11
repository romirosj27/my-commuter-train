import { serviceCalls, services, type Db } from '@mct/db';
import { and, eq, gte, lte } from '@mct/db/orm';

/**
 * Services departing soon. Re-evaluating them periodically catches alerts
 * that depend on time rather than a feed change (quiet hours ending, or a
 * prediction shifting because of another train).
 */
export async function servicesDepartingSoon(db: Db, now: Date, aheadMin = 180, behindMin = 15): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: services.id })
    .from(serviceCalls)
    .innerJoin(services, eq(services.id, serviceCalls.serviceId))
    .where(
      and(
        gte(serviceCalls.schedDep, new Date(now.getTime() - behindMin * 60_000)),
        lte(serviceCalls.schedDep, new Date(now.getTime() + aheadMin * 60_000)),
      ),
    );
  return rows.map((r) => r.id);
}
