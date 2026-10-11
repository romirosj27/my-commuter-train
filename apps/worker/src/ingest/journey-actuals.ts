/**
 * Fills in actual arrival times for journeys users have logged but that
 * don't have one yet: from live data while the service is still held, then
 * from HSP (historical service performance) once it has been purged.
 * Only ever touches journeys the user has confirmed.
 */
import { journeys, serviceCalls, services, type Db } from '@mct/db';
import { and, asc, eq, gte, isNull, lt } from '@mct/db/orm';
import { addDays, arrivalDelayMin, formatLondonHm, toLondon, type HspClient } from '@mct/shared';

export interface JourneyActualsResult {
  checked: number;
  fromLive: number;
  fromHsp: number;
}

export async function fillJourneyActuals(
  db: Db,
  hsp: HspClient,
  now: Date,
  opts: { lookbackDays?: number; log?: (msg: string, err: unknown) => void } = {},
): Promise<JourneyActualsResult> {
  const today = toLondon(now).date;
  const pending = await db
    .select()
    .from(journeys)
    .where(
      and(
        eq(journeys.status, 'confirmed'),
        isNull(journeys.actualArr),
        eq(journeys.destCancelled, false),
        gte(journeys.travelDate, addDays(today, -(opts.lookbackDays ?? 28))),
        lt(journeys.schedArr, now),
      ),
    )
    .limit(500);

  const result: JourneyActualsResult = { checked: pending.length, fromLive: 0, fromHsp: 0 };
  for (const j of pending) {
    const dest = j.destCrs.trim();
    let actual: Date | null = null;
    let cancelled = false;
    let source: 'live' | 'hsp' | null = null;

    if (j.serviceId) {
      const [svc] = await db.select().from(services).where(eq(services.id, j.serviceId));
      const calls = svc ? await db.select().from(serviceCalls).where(eq(serviceCalls.serviceId, svc.id)).orderBy(asc(serviceCalls.seq)) : [];
      const arr = calls.find((c) => c.crs?.trim() === dest && c.schedArr?.getTime() === j.schedArr.getTime());
      if (arr) {
        actual = arr.actualArr;
        cancelled = svc!.isCancelled || arr.isCancelled;
        source = 'live';
      }
    }

    if (!source) {
      try {
        const dep = formatLondonHm(j.schedDep);
        const weekday = toLondon(new Date(`${j.travelDate}T12:00:00Z`)).weekday;
        const summaries = await hsp.serviceMetrics({
          fromCrs: j.originCrs.trim(),
          toCrs: dest,
          fromDate: j.travelDate,
          toDate: j.travelDate,
          fromTime: dep,
          toTime: formatLondonHm(new Date(j.schedDep.getTime() + 60_000)),
          days: weekday === 6 ? 'saturday' : weekday === 7 ? 'sunday' : 'weekday',
          tocs: [j.toc.trim()],
        });
        const match = summaries.find((s) => s.schedDepLocal === dep && s.toc === j.toc.trim());
        if (match) {
          const detail = await hsp.serviceDetails(match.serviceRef);
          const arr = detail.calls.find((c) => c.crs === dest);
          if (arr) {
            actual = arr.actualArr ? new Date(arr.actualArr) : null;
            source = 'hsp';
          }
        }
      } catch (err) {
        opts.log?.('HSP lookup failed', err);
      }
    }

    if (!source || (!actual && !cancelled)) continue;
    await db
      .update(journeys)
      .set({
        actualArr: actual,
        arrivalDelayMin: arrivalDelayMin(j.schedArr, actual),
        destCancelled: cancelled,
      })
      .where(eq(journeys.id, j.id));
    if (source === 'live') result.fromLive++;
    else result.fromHsp++;
  }
  return result;
}
