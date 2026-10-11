/**
 * Demo railway: replays the same mock scenarios as the worker, in the
 * browser, and answers board / service / prediction questions with the same
 * shared logic the API uses.
 */
import {
  addDays,
  callView,
  combine,
  demoCrsForTiploc,
  demoOperators,
  demoStations,
  demoTiplocs,
  DEFAULT_PREDICTION_CONFIG,
  formatLondonHm,
  formingServiceRule,
  fromLondon,
  journeyStatus,
  minutesBetween,
  publishedIncidentRule,
  toLondon,
  upstreamDisruptionRule,
  type BoardService,
  type CallView,
  type LinkedService,
  type NetworkObservation,
  type RiskSummary,
  type ServiceDetail,
  type StoredCall,
  type TrainAhead,
} from '@mct/shared';
import { compileScenario, reduce, scenarioRunsOn, scenarioSchema, type CompiledScenario, type Scenario, type ServiceState } from '@mct/shared/mock';

const files = import.meta.glob<{ default: unknown }>('../../../../fixtures/scenarios/*.json', { eager: true });
const scenarios: Scenario[] = Object.keys(files)
  .sort()
  .map((k) => scenarioSchema.parse(files[k]!.default));

const compiled = new Map<string, CompiledScenario[]>();
function forDate(date: string): CompiledScenario[] {
  let c = compiled.get(date);
  if (!c) {
    c = scenarios.filter((s) => scenarioRunsOn(s, date)).map((s) => compileScenario(s, date));
    compiled.set(date, c);
  }
  return c;
}

const stationNames = new Map(demoStations.map((s) => [s.crs, s.name]));
const tiplocNames = new Map(demoTiplocs.map((t) => [t.tiploc, t.name]));
const operatorNames = new Map(demoOperators.map((o) => [o.code, o.name]));
export const stationName = (crs: string) => stationNames.get(crs) ?? crs;
export const operatorName = (toc: string) => operatorNames.get(toc) ?? toc;
const location = (tiploc: string | null, crs?: string | null) =>
  (crs && stationNames.get(crs)) || (tiploc && tiplocNames.get(tiploc)) || tiploc || 'Unknown';

export interface RailwayState {
  now: Date;
  services: Map<string, ServiceState>;
  scenarios: CompiledScenario[];
}

let cache: { key: string; state: RailwayState } | null = null;

/** Everything that has happened by `now` (to the minute) for yesterday, today and tomorrow. */
export function railwayAt(now: Date): RailwayState {
  const key = now.toISOString().slice(0, 16);
  if (cache?.key === key) return cache.state;
  const today = toLondon(now).date;
  const sc = [addDays(today, -1), today, addDays(today, 1)].flatMap(forDate);
  const iso = now.toISOString();
  const events = sc.flatMap((c) => c.darwin).filter((e) => e.at <= iso).sort((a, b) => a.at.localeCompare(b.at));
  const state = { now, services: reduce(events), scenarios: sc };
  cache = { key, state };
  return state;
}

/** Service ids in the demo are URL-safe forms of the feed id. */
export const serviceIdOf = (feedId: string) => feedId.replaceAll(':', '_');
const feedIdOf = (serviceId: string) => serviceId.replaceAll('_', ':');

const toStored = (c: ServiceState['calls'][number]): StoredCall => ({
  ...c,
  schedArr: c.schedArr ? new Date(c.schedArr) : null,
  schedDep: c.schedDep ? new Date(c.schedDep) : null,
  fcstArr: c.fcstArr ? new Date(c.fcstArr) : null,
  fcstDep: c.fcstDep ? new Date(c.fcstDep) : null,
  actualArr: c.actualArr ? new Date(c.actualArr) : null,
  actualDep: c.actualDep ? new Date(c.actualDep) : null,
});
const viewOf = (c: ServiceState['calls'][number]) => callView(toStored(c), location(c.tiploc, c.crs));
const stops = (c: { activity: string }) => c.activity !== 'pass';
const exp = (actual: string | null, fcst: string | null) => actual ?? fcst;

function legIndexes(s: ServiceState, fromCrs?: string | null, toCrs?: string | null) {
  let i = fromCrs ? s.calls.findIndex((c) => stops(c) && c.crs === fromCrs && c.activity !== 'destination') : 0;
  if (i < 0) return null;
  let j = toCrs ? s.calls.findIndex((c, k) => k > i && stops(c) && c.crs === toCrs) : s.calls.length - 1;
  if (j < 0) return null;
  if (!fromCrs) i = 0;
  if (!toCrs) j = s.calls.length - 1;
  return { i, j };
}

// ---------------------------------------------------------------------------
// Prediction (mirrors @mct/db PredictionInputs over the in-memory state)
// ---------------------------------------------------------------------------

function assess(r: RailwayState, s: ServiceState, i: number, j: number): RiskSummary {
  const cfg = DEFAULT_PREDICTION_CONFIG;
  const feedId = s.service.feedId;
  const toc = s.service.toc;

  // Forming service
  let formedBy: { main: ServiceState; tiploc: string } | null = null;
  for (const m of r.services.values()) {
    const a = m.associations.find((x) => x.assocFeedId === feedId && x.association === 'forms');
    if (a) formedBy = { main: m, tiploc: a.tiploc };
  }
  const here = (formedBy && s.calls.find((c) => c.tiploc === formedBy.tiploc)) || s.calls[0]!;
  let inbound = null;
  if (formedBy) {
    const arr = formedBy.main.calls.findLast((c) => c.tiploc === formedBy.tiploc);
    const e = arr ? exp(arr.actualArr, arr.fcstArr) : null;
    inbound = {
      origin: location(formedBy.main.calls[0]?.tiploc ?? null),
      isCancelled: formedBy.main.isCancelled || (arr?.isCancelled ?? false),
      scheduledArrival: arr?.schedArr ? new Date(arr.schedArr) : null,
      expectedArrival: e ? new Date(e) : null,
    };
  }
  const forming = formingServiceRule(
    {
      inbound,
      location: { name: location(here.tiploc, here.crs), crs: here.crs },
      scheduledDeparture: new Date((here.schedDep ?? here.schedArr)!),
      departed: here.actualDep !== null,
      toc,
    },
    cfg,
  );

  // Upstream: other trains on the same journey, leaving before ours
  const from = s.calls[i]!;
  const to = s.calls[j]!;
  const ourDep = new Date((from.schedDep ?? from.schedArr)!);
  const windowStart = ourDep.getTime() - Math.max(cfg.upstream.delayWindowMin, cfg.upstream.cancelWindowMin) * 60_000;
  const ahead: TrainAhead[] = [];
  for (const o of r.services.values()) {
    if (o.service.feedId === feedId) continue;
    const idx = legIndexes(o, from.crs, to.crs);
    if (!idx) continue;
    const d = o.calls[idx.i]!;
    if (!d.schedDep) continue;
    const t = new Date(d.schedDep).getTime();
    if (t < windowStart || t >= ourDep.getTime()) continue;
    let worst: number | null = null;
    for (const c of o.calls.slice(idx.i, idx.j + 1).filter(stops)) {
      for (const [sched, e] of [
        [c.schedArr, exp(c.actualArr, c.fcstArr)],
        [c.schedDep, exp(c.actualDep, c.fcstDep)],
      ] as const) {
        if (sched && e) worst = Math.max(worst ?? -Infinity, minutesBetween(new Date(sched), new Date(e)));
      }
    }
    ahead.push({
      label: `${formatLondonHm(new Date(d.schedDep))} to ${location(o.calls.at(-1)!.tiploc)}`,
      scheduledDeparture: new Date(d.schedDep),
      isCancelled: o.isCancelled || d.isCancelled,
      delayMin: worst,
    });
  }
  const routeCrs = s.calls.slice(i, j + 1).filter(stops).map((c) => c.crs).filter((x): x is string => !!x);
  const nowIso = r.now.toISOString();
  const network: NetworkObservation[] = r.scenarios
    .flatMap((c) => c.network)
    .filter((n) => n.at <= nowIso && n.kind !== 'berth_step' && n.feedId !== feedId)
    .flatMap((n) => {
      if (n.kind === 'berth_step' || !n.tiploc) return [];
      const crs = demoCrsForTiploc(n.tiploc);
      if (!crs || !routeCrs.includes(crs)) return [];
      return [{ kind: n.kind, station: location(n.tiploc, crs), observedAt: new Date(n.at), delayMin: n.kind === 'movement' ? n.delayMin : null }];
    });
  const upstream = upstreamDisruptionRule({ scheduledDeparture: ourDep, now: r.now, ahead, network }, cfg);

  // Published incidents
  const arrival = exp(to.actualArr, to.fcstArr) ?? to.schedArr;
  const incidents = r.scenarios
    .flatMap((c) => c.incidents)
    .filter((x) => x.startsAt <= nowIso)
    .map((x) => ({ ...x, startsAt: new Date(x.startsAt), endsAt: x.endsAt ? new Date(x.endsAt) : null }));
  const incident = publishedIncidentRule(
    { routeCrs, toc, from: r.now, to: arrival && arrival > nowIso ? new Date(arrival) : r.now, incidents },
    cfg,
  );
  return combine([forming, upstream, incident]);
}

// ---------------------------------------------------------------------------

export interface BoardArgs {
  fromCrs: string;
  toCrs: string;
  date: string;
  start: string;
  end: string;
  operators: string[];
}

export function board(r: RailwayState, q: BoardArgs): BoardService[] {
  const from = fromLondon(q.date, q.start);
  const to = fromLondon(q.end <= q.start ? addDays(q.date, 1) : q.date, q.end);
  const out: BoardService[] = [];
  for (const s of r.services.values()) {
    if (q.operators.length && !q.operators.includes(s.service.toc)) continue;
    const idx = legIndexes(s, q.fromCrs, q.toCrs);
    if (!idx) continue;
    const d = s.calls[idx.i]!;
    if (!d.schedDep) continue;
    const t = new Date(d.schedDep);
    if (t < from || t >= to) continue;
    const fromView = viewOf(d);
    const toView = viewOf(s.calls[idx.j]!);
    const { status, progress, delayMin } = journeyStatus(fromView, toView);
    const row: BoardService = {
      serviceId: serviceIdOf(s.service.feedId),
      headcode: s.service.headcode,
      toc: s.service.toc,
      operator: operatorName(s.service.toc),
      origin: location(s.calls[0]!.tiploc),
      destination: location(s.calls.at(-1)!.tiploc),
      from: fromView,
      to: toView,
      status,
      progress,
      delayMin,
      reason:
        status === 'cancelled'
          ? (fromView.reason ?? s.cancelReason)
          : status === 'part_cancelled'
            ? (toView.reason ?? s.cancelReason)
            : (toView.reason ?? fromView.reason ?? s.calls.find((c) => c.delayReason)?.delayReason ?? null),
    };
    if (status !== 'cancelled' && progress !== 'arrived') row.risk = assess(r, s, idx.i, idx.j);
    out.push(row);
  }
  return out.sort((a, b) => (a.from.departure.scheduled ?? '').localeCompare(b.from.departure.scheduled ?? ''));
}

function linked(r: RailwayState, s: ServiceState, tiploc: string, side: 'arr' | 'dep'): LinkedService {
  const at = side === 'arr' ? s.calls.findLast((c) => c.tiploc === tiploc) : s.calls.find((c) => c.tiploc === tiploc);
  void r;
  return {
    serviceId: serviceIdOf(s.service.feedId),
    headcode: s.service.headcode,
    toc: s.service.toc,
    origin: location(s.calls[0]!.tiploc),
    destination: location(s.calls.at(-1)!.tiploc),
    isCancelled: s.isCancelled,
    at: at ? viewOf(at) : null,
  };
}

export function serviceDetail(r: RailwayState, serviceId: string, fromCrs?: string | null, toCrs?: string | null): ServiceDetail | null {
  const s = r.services.get(feedIdOf(serviceId));
  if (!s) return null;
  const feedId = s.service.feedId;
  let formedBy: LinkedService | null = null;
  for (const m of r.services.values()) {
    const a = m.associations.find((x) => x.assocFeedId === feedId && x.association === 'forms');
    if (a) formedBy = linked(r, m, a.tiploc, 'arr');
  }
  const formsAssoc = s.associations.find((a) => a.association === 'forms');
  const formsSvc = formsAssoc ? r.services.get(formsAssoc.assocFeedId) : undefined;
  const idx = legIndexes(s, fromCrs, toCrs) ?? { i: 0, j: s.calls.length - 1 };
  const delayReason = s.calls.find((c) => c.delayReason)?.delayReason ?? null;
  return {
    serviceId,
    headcode: s.service.headcode,
    toc: s.service.toc,
    operator: operatorName(s.service.toc),
    ssd: s.service.ssd,
    origin: location(s.calls[0]!.tiploc),
    destination: location(s.calls.at(-1)!.tiploc),
    isCancelled: s.isCancelled,
    reason: s.isCancelled ? s.cancelReason : delayReason,
    calls: s.calls.map(viewOf),
    formedBy,
    forms: formsSvc && formsAssoc ? linked(r, formsSvc, formsAssoc.tiploc, 'dep') : null,
    ...(s.isCancelled ? {} : { risk: assess(r, s, idx.i, idx.j) }),
  };
}

/** The leg of a service between two stations (for logging a journey). */
export function leg(r: RailwayState, serviceId: string, fromCrs: string, toCrs: string): { s: ServiceState; from: CallView; to: CallView } | null {
  const s = r.services.get(feedIdOf(serviceId));
  if (!s) return null;
  const idx = legIndexes(s, fromCrs, toCrs);
  if (!idx) return null;
  return { s, from: viewOf(s.calls[idx.i]!), to: viewOf(s.calls[idx.j]!) };
}
