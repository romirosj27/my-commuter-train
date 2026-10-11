/**
 * Rule-based disruption prediction (no machine learning in the MVP).
 *
 * Each rule is a pure function returning `{ risk, reason }` with a
 * human-readable reason. `combine` takes the highest risk and keeps every
 * reason, most severe first. Thresholds live in `PredictionConfig`.
 */
import { z } from 'zod';
import type { RiskLevel, RiskSummary } from '../board.ts';
import { formatLondonHm, minutesBetween } from '../time/index.ts';

export type RuleName = 'forming' | 'upstream' | 'incident';

export interface Prediction {
  rule: RuleName;
  risk: RiskLevel;
  reason: string;
}

export interface PredictionConfig {
  /** Minimum time to turn a unit round at a terminus, in minutes. */
  minTurnaroundMin: number;
  /** Per-location overrides: key `CRS` or `CRS:TOC` (more specific wins). */
  turnaroundOverrides: Record<string, number>;
  forming: {
    /** Predicted knock-on delay (minutes) at or above which risk is high; any positive knock-on is medium. */
    highFromMin: number;
  };
  upstream: {
    /** Look this far ahead of the user's train for a significantly delayed train (minutes). */
    delayWindowMin: number;
    /** Look this far ahead for a cancelled train (minutes). */
    cancelWindowMin: number;
    /** A delay of at least this many minutes counts as significant. */
    significantDelayMin: number;
    /** Network events this recent count (minutes before now). */
    networkLookbackMin: number;
  };
}

export const DEFAULT_PREDICTION_CONFIG: PredictionConfig = {
  minTurnaroundMin: 5,
  turnaroundOverrides: {},
  forming: { highFromMin: 10 },
  upstream: { delayWindowMin: 60, cancelWindowMin: 30, significantDelayMin: 10, networkLookbackMin: 30 },
};

const RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
const hm = (d: Date) => formatLondonHm(d);

export function turnaroundFor(cfg: PredictionConfig, crs: string | null, toc: string): number {
  if (crs) {
    const specific = cfg.turnaroundOverrides[`${crs}:${toc}`] ?? cfg.turnaroundOverrides[crs];
    if (specific !== undefined) return specific;
  }
  return cfg.minTurnaroundMin;
}

// ---------------------------------------------------------------------------
// 1. Forming service
// ---------------------------------------------------------------------------

export interface FormingInput {
  /** The inbound service whose unit forms ours; null if none is known. */
  inbound: {
    origin: string;
    isCancelled: boolean;
    scheduledArrival: Date | null;
    /** Actual arrival if known, else forecast; null if no report. */
    expectedArrival: Date | null;
  } | null;
  /** Where the unit turns round (our service's origin). */
  location: { name: string; crs: string | null };
  /** Our scheduled departure from that location. */
  scheduledDeparture: Date;
  /** True once our service has left that location (the rule no longer applies). */
  departed: boolean;
  toc: string;
}

/**
 * If the inbound train arrives later than our departure minus the minimum
 * turnaround, our train can't leave on time: predict the knock-on delay.
 */
export function formingServiceRule(input: FormingInput, cfg: PredictionConfig = DEFAULT_PREDICTION_CONFIG): Prediction {
  const rule = 'forming' as const;
  const { inbound } = input;
  if (input.departed) return { rule, risk: 'low', reason: 'This train has already started its journey.' };
  if (!inbound) return { rule, risk: 'low', reason: 'No information about the train that forms this service.' };
  if (inbound.isCancelled) {
    return {
      rule,
      risk: 'high',
      reason: `The train due to form this service (from ${inbound.origin}) is cancelled, so another unit will be needed.`,
    };
  }
  if (!inbound.expectedArrival) return { rule, risk: 'low', reason: 'No running information yet for the train that forms this service.' };

  const turnaround = turnaroundFor(cfg, input.location.crs, input.toc);
  const readyAt = new Date(inbound.expectedArrival.getTime() + turnaround * 60_000);
  const knockOn = minutesBetween(input.scheduledDeparture, readyAt);
  if (knockOn <= 0) return { rule, risk: 'low', reason: 'The train that forms this service is in time to turn round.' };

  const late = inbound.scheduledArrival ? minutesBetween(inbound.scheduledArrival, inbound.expectedArrival) : null;
  return {
    rule,
    risk: knockOn >= cfg.forming.highFromMin ? 'high' : 'medium',
    reason:
      `The train forming this service is due into ${input.location.name} at ${hm(inbound.expectedArrival)}` +
      `${late && late > 0 ? `, ${late} min late` : ''}. ` +
      `Allowing ${turnaround} min to turn round, it could leave about ${knockOn} min late.`,
  };
}

// ---------------------------------------------------------------------------
// 2. Upstream disruption
// ---------------------------------------------------------------------------

export interface TrainAhead {
  /** e.g. "07:25 to York" */
  label: string;
  /** Its scheduled departure from the user's station. */
  scheduledDeparture: Date;
  isCancelled: boolean;
  /** Its worst current lateness between the user's stations, in minutes (null if no report). */
  delayMin: number | null;
}

export interface NetworkObservation {
  kind: 'movement' | 'cancellation';
  station: string;
  observedAt: Date;
  delayMin: number | null;
}

export interface UpstreamInput {
  /** Our scheduled departure from the user's station. */
  scheduledDeparture: Date;
  now: Date;
  /** Other trains on the same route (same origin and destination for the user), departing before ours. */
  ahead: TrainAhead[];
  /** Network-wide events at stations on our route (other trains only). */
  network: NetworkObservation[];
}

/** A cancellation or significant delay to a train ahead on the same route, within a time window. */
export function upstreamDisruptionRule(input: UpstreamInput, cfg: PredictionConfig = DEFAULT_PREDICTION_CONFIG): Prediction {
  const rule = 'upstream' as const;
  const c = cfg.upstream;
  const minsBefore = (t: TrainAhead) => minutesBetween(t.scheduledDeparture, input.scheduledDeparture);
  const ahead = input.ahead.filter((t) => minsBefore(t) > 0).sort((a, b) => minsBefore(a) - minsBefore(b));

  const cancelled = ahead.find((t) => t.isCancelled && minsBefore(t) <= c.cancelWindowMin);
  if (cancelled) return { rule, risk: 'high', reason: `The ${cancelled.label} just ahead of yours is cancelled.` };

  const delayed = ahead
    .filter((t) => !t.isCancelled && (t.delayMin ?? 0) >= c.significantDelayMin && minsBefore(t) <= c.delayWindowMin)
    .sort((a, b) => (b.delayMin ?? 0) - (a.delayMin ?? 0))[0];
  if (delayed) return { rule, risk: 'medium', reason: `The ${delayed.label} ahead of yours is ${delayed.delayMin} min late.` };

  const since = input.now.getTime() - c.networkLookbackMin * 60_000;
  const recent = input.network.filter((n) => n.observedAt.getTime() >= since && n.observedAt.getTime() <= input.now.getTime());
  const netDelay = recent
    .filter((n) => n.kind === 'movement' && (n.delayMin ?? 0) >= c.significantDelayMin)
    .sort((a, b) => (b.delayMin ?? 0) - (a.delayMin ?? 0))[0];
  if (netDelay) return { rule, risk: 'medium', reason: `Trains near ${netDelay.station} are running up to ${netDelay.delayMin} min late.` };
  const netCancel = recent.find((n) => n.kind === 'cancellation');
  if (netCancel) return { rule, risk: 'medium', reason: `A train at ${netCancel.station} was cancelled at ${hm(netCancel.observedAt)}.` };

  return { rule, risk: 'low', reason: 'No disruption reported to trains ahead on your route.' };
}

// ---------------------------------------------------------------------------
// 3. Published incidents
// ---------------------------------------------------------------------------

export interface IncidentInput {
  /** Stations the user's journey calls at, in order (origin first, destination last). */
  routeCrs: string[];
  toc: string;
  /** The period the journey covers: from now (or departure) to arrival. */
  from: Date;
  to: Date;
  incidents: Array<{ summary: string; affectedCrs: string[]; operatorCodes: string[]; startsAt: Date; endsAt: Date | null }>;
}

/** An incident whose affected locations include a station on the user's route. */
export function publishedIncidentRule(input: IncidentInput, cfg: PredictionConfig = DEFAULT_PREDICTION_CONFIG): Prediction {
  void cfg;
  const rule = 'incident' as const;
  const ends = new Set([input.routeCrs[0], input.routeCrs.at(-1)]);
  const route = new Set(input.routeCrs);
  let best: Prediction | null = null;
  for (const i of input.incidents) {
    if (i.operatorCodes.length && !i.operatorCodes.includes(input.toc)) continue;
    const active = i.startsAt.getTime() <= input.to.getTime() && (i.endsAt === null || i.endsAt.getTime() > input.from.getTime());
    if (!active) continue;
    const hits = i.affectedCrs.filter((crs) => route.has(crs));
    if (!hits.length) continue;
    const risk: RiskLevel = hits.some((crs) => ends.has(crs)) ? 'high' : 'medium';
    if (!best || RANK[risk] > RANK[best.risk]) best = { rule, risk, reason: i.summary };
  }
  return best ?? { rule, risk: 'low', reason: 'No published incidents on your route.' };
}

// ---------------------------------------------------------------------------

/** Highest risk wins; every reason is kept, most severe first. */
export function combine(predictions: Prediction[]): RiskSummary {
  const sorted = [...predictions].sort((a, b) => RANK[b.risk] - RANK[a.risk]);
  return {
    risk: sorted[0]?.risk ?? 'low',
    reasons: sorted.map((p) => p.reason),
    factors: sorted,
  };
}

// ---------------------------------------------------------------------------
// Configuration from the environment (PREDICTION_CONFIG, JSON; any subset).
// ---------------------------------------------------------------------------


const minutes = z.number().int().min(0).max(24 * 60);
export const predictionConfigSchema = z
  .object({
    minTurnaroundMin: minutes,
    turnaroundOverrides: z.record(z.string().regex(/^[A-Z]{3}(:[A-Z0-9]{2})?$/), minutes),
    forming: z.object({ highFromMin: minutes }).partial().strict(),
    upstream: z
      .object({ delayWindowMin: minutes, cancelWindowMin: minutes, significantDelayMin: minutes, networkLookbackMin: minutes })
      .partial()
      .strict(),
  })
  .partial()
  .strict();

/** Merges a JSON override (e.g. from PREDICTION_CONFIG) onto the defaults; throws on invalid input. */
export function predictionConfigFromJson(json: string | undefined): PredictionConfig {
  if (!json?.trim()) return DEFAULT_PREDICTION_CONFIG;
  const o = predictionConfigSchema.parse(JSON.parse(json));
  const d = DEFAULT_PREDICTION_CONFIG;
  return {
    minTurnaroundMin: o.minTurnaroundMin ?? d.minTurnaroundMin,
    turnaroundOverrides: { ...d.turnaroundOverrides, ...o.turnaroundOverrides },
    forming: { ...d.forming, ...o.forming },
    upstream: { ...d.upstream, ...o.upstream },
  };
}
