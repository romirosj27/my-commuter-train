/**
 * Gathers the inputs for the prediction rules from the database and combines
 * the results. Used by the API (board, service detail) and the worker (alerts)
 * so both see the same risk for a journey.
 */
import {
  combine,
  DEFAULT_PREDICTION_CONFIG,
  formatLondonHm,
  formingServiceRule,
  minutesBetween,
  publishedIncidentRule,
  upstreamDisruptionRule,
  type NetworkObservation,
  type PredictionConfig,
  type RiskSummary,
  type TrainAhead,
} from '@mct/shared';
import { aliasedTable, and, arrayOverlaps, asc, eq, gt, gte, inArray, isNull, lt, lte, ne, or } from 'drizzle-orm';
import type { Db } from './index.ts';
import { associations, incidents, networkEvents, serviceCalls, services, stations, tiplocs } from './schema.ts';

type CallRow = typeof serviceCalls.$inferSelect;

export interface JourneyRef {
  serviceId: string;
  /** The user's boarding and alighting stations; default to the service's origin and destination. */
  fromCrs?: string | null;
  toCrs?: string | null;
}

const trim = (s: string | null) => s?.trim() ?? null;
const expected = (actual: Date | null, forecast: Date | null) => actual ?? forecast;

export class PredictionInputs {
  private names: { at: number; crs: Map<string, string>; tiploc: Map<string, string> } | null = null;

  constructor(
    private readonly db: Db,
    private readonly cfg: PredictionConfig = DEFAULT_PREDICTION_CONFIG,
  ) {}

  private async name(tiploc: string | null, crs: string | null): Promise<string> {
    if (!this.names || Date.now() - this.names.at > 10 * 60_000) {
      const [s, t] = await Promise.all([
        this.db.select({ crs: stations.crs, name: stations.name }).from(stations),
        this.db.select({ tiploc: tiplocs.tiploc, name: tiplocs.name }).from(tiplocs),
      ]);
      this.names = { at: Date.now(), crs: new Map(s.map((r) => [r.crs.trim(), r.name])), tiploc: new Map(t.map((r) => [r.tiploc, r.name])) };
    }
    return (crs && this.names.crs.get(crs.trim())) || (tiploc && this.names.tiploc.get(tiploc)) || tiploc || 'Unknown';
  }

  /** Risk for a journey on a service, as of `now`. Null if the service isn't known. */
  async assess(ref: JourneyRef, now: Date): Promise<RiskSummary | null> {
    const [svc] = await this.db.select().from(services).where(eq(services.id, ref.serviceId));
    if (!svc) return null;
    const calls = await this.db.select().from(serviceCalls).where(eq(serviceCalls.serviceId, svc.id)).orderBy(asc(serviceCalls.seq));
    if (calls.length < 2) return null;
    const stops = (c: CallRow) => c.activity !== 'pass';
    let i = ref.fromCrs ? calls.findIndex((c) => stops(c) && trim(c.crs) === ref.fromCrs && c.activity !== 'destination') : 0;
    if (i < 0) i = 0;
    let j = ref.toCrs ? calls.findIndex((c, k) => k > i && stops(c) && trim(c.crs) === ref.toCrs) : calls.length - 1;
    if (j < 0) j = calls.length - 1;
    const from = calls[i]!;
    const to = calls[j]!;
    const toc = svc.toc.trim();

    const [forming, upstream, incident] = await Promise.all([
      this.forming(svc.feedId, toc, calls),
      this.upstream(svc.id, svc.feedId, from, to, calls.slice(i, j + 1), now),
      this.incident(toc, calls.slice(i, j + 1), to, now),
    ]);
    return combine([forming, upstream, incident]);
  }

  private async forming(feedId: string, toc: string, calls: CallRow[]) {
    const [assoc] = await this.db
      .select()
      .from(associations)
      .where(and(eq(associations.assocFeedId, feedId), eq(associations.kind, 'forms')));
    // Where the unit turns round: our call at the association location, else our origin.
    const here = (assoc && calls.find((c) => c.tiploc === assoc.tiploc)) || calls[0]!;
    const location = { name: await this.name(here.tiploc, trim(here.crs)), crs: trim(here.crs) };
    const scheduledDeparture = here.schedDep ?? here.schedArr!;
    const departed = here.actualDep !== null;
    let inbound = null;
    if (assoc) {
      const [main] = await this.db.select().from(services).where(eq(services.feedId, assoc.mainFeedId));
      if (main) {
        const mainCalls = await this.db.select().from(serviceCalls).where(eq(serviceCalls.serviceId, main.id)).orderBy(asc(serviceCalls.seq));
        const arr = mainCalls.findLast((c) => c.tiploc === assoc.tiploc);
        inbound = {
          origin: await this.name(main.originTiploc, null),
          isCancelled: main.isCancelled || (arr?.isCancelled ?? false),
          scheduledArrival: arr?.schedArr ?? null,
          expectedArrival: arr ? expected(arr.actualArr, arr.fcstArr) : null,
        };
      }
    }
    return formingServiceRule({ inbound, location, scheduledDeparture, departed, toc }, this.cfg);
  }

  private async upstream(serviceId: string, feedId: string, from: CallRow, to: CallRow, route: CallRow[], now: Date) {
    const ourDep = from.schedDep ?? from.schedArr!;
    const c = this.cfg.upstream;
    const windowStart = new Date(ourDep.getTime() - Math.max(c.delayWindowMin, c.cancelWindowMin) * 60_000);
    const dep = aliasedTable(serviceCalls, 'dep');
    const arr = aliasedTable(serviceCalls, 'arr');
    const rows = await this.db
      .selectDistinctOn([dep.serviceId], { svc: services, dep, arrSeq: arr.seq })
      .from(dep)
      .innerJoin(services, eq(services.id, dep.serviceId))
      .innerJoin(arr, and(eq(arr.serviceId, dep.serviceId), gt(arr.seq, dep.seq), eq(arr.crs, trim(to.crs) ?? ''), ne(arr.activity, 'pass')))
      .where(
        and(
          eq(dep.crs, trim(from.crs) ?? ''),
          ne(dep.activity, 'pass'),
          ne(dep.serviceId, serviceId),
          gte(dep.schedDep, windowStart),
          lt(dep.schedDep, ourDep),
        ),
      )
      .orderBy(asc(dep.serviceId), asc(dep.seq));
    // A train ahead's delay is its worst current lateness between the user's two stations.
    const aheadCalls = rows.length
      ? await this.db.select().from(serviceCalls).where(inArray(serviceCalls.serviceId, rows.map((r) => r.svc.id)))
      : [];
    const ahead: TrainAhead[] = await Promise.all(
      rows.map(async ({ svc, dep: d, arrSeq }) => {
        let worst: number | null = null;
        for (const c of aheadCalls) {
          if (c.serviceId !== svc.id || c.seq < d.seq || c.seq > arrSeq || c.activity === 'pass') continue;
          for (const [sched, exp] of [
            [c.schedArr, expected(c.actualArr, c.fcstArr)],
            [c.schedDep, expected(c.actualDep, c.fcstDep)],
          ] as const) {
            if (sched && exp) worst = Math.max(worst ?? -Infinity, minutesBetween(sched, exp));
          }
        }
        return {
          label: `${formatLondonHm(d.schedDep!)} to ${await this.name(svc.destTiploc, null)}`,
          scheduledDeparture: d.schedDep!,
          isCancelled: svc.isCancelled || d.isCancelled,
          delayMin: worst,
        };
      }),
    );

    const routeCrs = [...new Set(route.map((r) => trim(r.crs)).filter((x): x is string => !!x))];
    const events = routeCrs.length
      ? await this.db
          .select()
          .from(networkEvents)
          .where(
            and(
              inArray(networkEvents.crs, routeCrs),
              gte(networkEvents.observedAt, new Date(now.getTime() - c.networkLookbackMin * 60_000)),
              lte(networkEvents.observedAt, now),
              or(isNull(networkEvents.serviceFeedId), ne(networkEvents.serviceFeedId, feedId)),
            ),
          )
      : [];
    const network: NetworkObservation[] = await Promise.all(
      events
        .filter((e) => e.kind === 'movement' || e.kind === 'cancellation')
        .map(async (e) => ({
          kind: e.kind as 'movement' | 'cancellation',
          station: await this.name(e.tiploc, trim(e.crs)),
          observedAt: e.observedAt,
          delayMin: e.delayMin,
        })),
    );
    return upstreamDisruptionRule({ scheduledDeparture: ourDep, now, ahead, network }, this.cfg);
  }

  private async incident(toc: string, route: CallRow[], to: CallRow, now: Date) {
    const routeCrs = route.filter((r) => r.activity !== 'pass').map((r) => trim(r.crs)).filter((x): x is string => !!x);
    const arrival = expected(to.actualArr, to.fcstArr) ?? to.schedArr ?? now;
    const rows = routeCrs.length
      ? await this.db
          .select()
          .from(incidents)
          .where(and(arrayOverlaps(incidents.affectedCrs, routeCrs), or(isNull(incidents.endsAt), gt(incidents.endsAt, now))))
      : [];
    return publishedIncidentRule(
      {
        routeCrs,
        toc,
        from: now,
        to: arrival.getTime() > now.getTime() ? arrival : now,
        incidents: rows.map((r) => ({ ...r, summary: r.summary })),
      },
      this.cfg,
    );
  }
}
