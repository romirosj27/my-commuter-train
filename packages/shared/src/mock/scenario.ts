/**
 * Mock scenario fixtures.
 *
 * This is OUR fixture format, not any feed's wire format. Scenarios describe
 * services in London wall-clock times relative to a service start date, plus a
 * timeline of changes. `compileScenario` turns a scenario into normalised feed
 * events for a given date, so the same fixtures replay every day.
 *
 * Browser-safe: used by the worker's mock feeds and by the web app's demo mode.
 */
import {
  addDays,
  demoCrsForTiploc,
  fromLondon,
  resolveNear,
  resolveTimeline,
  type CallRef,
  type CallUpdate,
  type DarwinEvent,
  type Incident,
  type NetworkEvent,
  type NormalisedCall,
} from '../index.ts';
import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const callSchema = z.object({
  tiploc: z.string(),
  arr: hhmm.optional(),
  dep: hhmm.optional(),
  plat: z.string().optional(),
  pass: z.boolean().optional(),
});

const serviceSchema = z.object({
  ref: z.string(),
  uid: z.string(),
  toc: z.string().length(2),
  headcode: z.string().optional(),
  /** Days after the scenario date that this service starts (default 0). */
  ssdOffset: z.number().int().default(0),
  calls: z.array(callSchema).min(2),
});

const updateSchema = z.object({
  tiploc: z.string(),
  /** Which occurrence of the TIPLOC in the calling pattern (default 0). */
  occurrence: z.number().int().default(0),
  eta: hhmm.optional(),
  etd: hhmm.optional(),
  ata: hhmm.optional(),
  atd: hhmm.optional(),
  plat: z.string().optional(),
  platConfirmed: z.boolean().optional(),
  delayReason: z.string().optional(),
});

const at = z.object({
  at: hhmm,
  /** Days after the scenario date (default 0). */
  day: z.number().int().default(0),
  /** Which instant to use when `at` falls in the October repeated hour. */
  fold: z.enum(['earlier', 'later']).default('earlier'),
});

const timelineSchema = z.discriminatedUnion('type', [
  at.extend({ type: z.literal('update'), ref: z.string(), calls: z.array(updateSchema).min(1) }),
  at.extend({
    type: z.literal('cancel'),
    ref: z.string(),
    /** Omit for a full cancellation; list TIPLOCs for a part cancellation. */
    tiplocs: z.array(z.string()).optional(),
    reason: z.string(),
  }),
  at.extend({ type: z.literal('reinstate'), ref: z.string() }),
]);

const associationSchema = z.object({
  main: z.string(),
  assoc: z.string(),
  kind: z.enum(['forms', 'join', 'divide']),
  tiploc: z.string(),
});

const networkSchema = z.discriminatedUnion('type', [
  at.extend({
    type: z.literal('movement'),
    trainRef: z.string(),
    /** Scenario service ref when the train is one of ours; omit for other traffic. */
    ref: z.string().optional(),
    tiploc: z.string(),
    delayMin: z.number().int(),
  }),
  at.extend({
    type: z.literal('cancellation'),
    trainRef: z.string(),
    ref: z.string().optional(),
    tiploc: z.string().optional(),
    reason: z.string().optional(),
  }),
]);

const incidentSchema = z.object({
  id: z.string(),
  summary: z.string(),
  description: z.string(),
  from: at,
  to: at.optional(),
  crs: z.array(z.string()),
  tocs: z.array(z.string()).default([]),
});

export const scenarioSchema = z.object({
  name: z.string(),
  description: z.string(),
  /** Fixed scenario date (YYYY-MM-DD). Omit to replay on any date. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  services: z.array(serviceSchema).min(1),
  associations: z.array(associationSchema).default([]),
  timeline: z.array(timelineSchema).default([]),
  network: z.array(networkSchema).default([]),
  incidents: z.array(incidentSchema).default([]),
});
export type Scenario = z.infer<typeof scenarioSchema>;

export interface CompiledScenario {
  name: string;
  date: string;
  /** All Darwin events, sorted by `at`. Schedules and associations are stamped at the start of the day before. */
  darwin: DarwinEvent[];
  network: NetworkEvent[];
  incidents: Incident[];
}

export function mockFeedId(ssd: string, uid: string): string {
  return `mock:${ssd}:${uid}`;
}

/** Whether a scenario replays on `date`. */
export function scenarioRunsOn(s: Scenario, date: string): boolean {
  return s.date === undefined || s.date === date;
}

export function compileScenario(s: Scenario, date: string): CompiledScenario {
  const published = fromLondon(addDays(date, -1), '00:00').toISOString();
  const stamp = (a: { at: string; day: number; fold: 'earlier' | 'later' }) =>
    fromLondon(addDays(date, a.day), a.at, a.fold).toISOString();

  interface Built {
    feedId: string;
    calls: NormalisedCall[];
  }
  const built = new Map<string, Built>();
  const darwin: DarwinEvent[] = [];

  for (const svc of s.services) {
    const ssd = addDays(date, svc.ssdOffset);
    const feedId = mockFeedId(ssd, svc.uid);
    // One flat timeline of arr/dep times in calling order, resolved together.
    const flat = svc.calls.flatMap((c) => [c.arr ?? null, c.dep ?? null]);
    const resolved = resolveTimeline(ssd, flat);
    const last = svc.calls.length - 1;
    const calls: NormalisedCall[] = svc.calls.map((c, i) => ({
      tiploc: c.tiploc,
      crs: demoCrsForTiploc(c.tiploc),
      activity: c.pass ? 'pass' : i === 0 ? 'origin' : i === last ? 'destination' : 'stop',
      schedArr: resolved[i * 2]?.toISOString() ?? null,
      schedDep: resolved[i * 2 + 1]?.toISOString() ?? null,
      platformBooked: c.plat ?? null,
    }));
    built.set(svc.ref, { feedId, calls });
    darwin.push({
      kind: 'schedule',
      at: published,
      service: { feedId, uid: svc.uid, ssd, toc: svc.toc, headcode: svc.headcode ?? null, isPassenger: true },
      calls,
    });
  }

  const svc = (ref: string): Built => {
    const b = built.get(ref);
    if (!b) throw new Error(`Scenario ${s.name}: unknown service ref ${ref}`);
    return b;
  };

  const callRef = (b: Built, tiploc: string, occurrence = 0): { ref: CallRef; call: NormalisedCall } => {
    const matches = b.calls.filter((c) => c.tiploc === tiploc);
    const call = matches[occurrence];
    if (!call) throw new Error(`Scenario ${s.name}: ${tiploc}#${occurrence} not in ${b.feedId}`);
    const sched = call.schedDep ?? call.schedArr ?? undefined;
    return { ref: matches.length > 1 && sched ? { tiploc, sched } : { tiploc }, call };
  };

  for (const a of s.associations) {
    darwin.push({
      kind: 'association',
      at: published,
      mainFeedId: svc(a.main).feedId,
      assocFeedId: svc(a.assoc).feedId,
      association: a.kind,
      tiploc: a.tiploc,
      deleted: false,
    });
  }

  for (const t of s.timeline) {
    const b = svc(t.ref);
    const when = stamp(t);
    if (t.type === 'update') {
      const calls: CallUpdate[] = t.calls.map((u) => {
        const { ref, call } = callRef(b, u.tiploc, u.occurrence);
        const near = (time: string | undefined, sched: string | null) => {
          if (time === undefined) return undefined;
          const reference = sched ?? call.schedDep ?? call.schedArr;
          if (!reference) throw new Error(`Scenario ${s.name}: no scheduled time at ${u.tiploc}`);
          return resolveNear(new Date(reference), time).toISOString();
        };
        const update: CallUpdate = { ...ref };
        const set = <K extends keyof CallUpdate>(k: K, v: CallUpdate[K] | undefined) => {
          if (v !== undefined) update[k] = v;
        };
        set('fcstArr', near(u.eta, call.schedArr));
        set('fcstDep', near(u.etd, call.schedDep));
        set('actualArr', near(u.ata, call.schedArr));
        set('actualDep', near(u.atd, call.schedDep));
        set('platform', u.plat);
        set('platformConfirmed', u.platConfirmed);
        set('delayReason', u.delayReason);
        return update;
      });
      darwin.push({ kind: 'update', at: when, feedId: b.feedId, calls });
    } else if (t.type === 'cancel') {
      darwin.push({
        kind: 'cancellation',
        at: when,
        feedId: b.feedId,
        scope: t.tiplocs ? t.tiplocs.map((tp) => callRef(b, tp).ref) : 'full',
        reason: t.reason,
      });
    } else {
      darwin.push({ kind: 'reinstatement', at: when, feedId: b.feedId });
    }
  }

  const network: NetworkEvent[] = s.network.map((n) =>
    n.type === 'movement'
      ? {
          kind: 'movement',
          at: stamp(n),
          trainRef: n.trainRef,
          feedId: n.ref ? svc(n.ref).feedId : null,
          tiploc: n.tiploc,
          delayMin: n.delayMin,
        }
      : {
          kind: 'cancellation',
          at: stamp(n),
          trainRef: n.trainRef,
          feedId: n.ref ? svc(n.ref).feedId : null,
          tiploc: n.tiploc ?? null,
          reason: n.reason ?? null,
        },
  );

  const incidents: Incident[] = s.incidents.map((i) => ({
    feedId: `mock:${date}:${i.id}`,
    summary: i.summary,
    description: i.description,
    startsAt: stamp(i.from),
    endsAt: i.to ? stamp(i.to) : null,
    affectedCrs: i.crs,
    operatorCodes: i.tocs,
    updatedAt: stamp(i.from),
  }));

  // Stable sort keeps fixture order for events at the same instant.
  darwin.sort((a, b) => a.at.localeCompare(b.at));
  network.sort((a, b) => a.at.localeCompare(b.at));
  return { name: s.name, date, darwin, network, incidents };
}
