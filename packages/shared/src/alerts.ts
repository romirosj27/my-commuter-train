/**
 * Alert decisions, as pure functions.
 *
 * The engine (worker) loads a service and the commutes that might care about
 * it; these functions decide which commute legs match, what each alert
 * condition currently is, and whether that is worth an email given what was
 * last sent. Dedupe and "material change" live here so they are testable.
 */
import type { AlertType } from './schemas/index.ts';
import { journeyStatus, type CallView, type RiskLevel } from './board.ts';
import { addDays, inLocalWindow, maskHasDay, toLondon } from './time/index.ts';

export interface AlertConfig {
  /** A delay follow-up is sent only when the delay moves by at least this much. */
  materialDelayDeltaMin: number;
  /** Stop alerting about a train this long after it was due to leave and has no report. */
  staleAfterMin: number;
}

export const DEFAULT_ALERT_CONFIG: AlertConfig = { materialDelayDeltaMin: 5, staleAfterMin: 15 };

export interface CommuteForAlerts {
  commuteId: string;
  userId: string;
  homeCrs: string;
  workCrs: string;
  outbound: { start: string; end: string };
  return: { start: string; end: string };
  activeDaysMask: number;
  operatorCodes: string[];
  settings: {
    enabled: boolean;
    types: AlertType[];
    delayThresholdMin: number;
    quietHours: { start: string; end: string } | null;
  };
}

export type Direction = 'outbound' | 'return';

export interface Leg {
  commuteId: string;
  direction: Direction;
  from: CallView;
  to: CallView;
  /** London date the commute window opened (the "travel day"). */
  travelDate: string;
}

/**
 * Which London day a departure counts towards for a window, or null if it's
 * outside the window. For a window that wraps midnight (e.g. 22:00–01:00), a
 * 00:30 departure belongs to the previous day.
 */
export function travelDayFor(departure: Date, window: { start: string; end: string }): string | null {
  const local = toLondon(departure);
  const hm = local.time.slice(0, 5);
  if (!inLocalWindow(hm, window.start, window.end)) return null;
  const wraps = window.end <= window.start;
  return wraps && hm < window.end ? addDays(local.date, -1) : local.date;
}

const weekdayOf = (date: string) => toLondon(new Date(`${date}T12:00:00Z`)).weekday;

/**
 * The leg of this service a commute would travel (home→work outbound or
 * work→home on return), if it matches the commute's operators, window and days.
 */
export function matchLeg(c: CommuteForAlerts, toc: string, calls: CallView[]): Leg | null {
  if (c.operatorCodes.length && !c.operatorCodes.includes(toc)) return null;
  for (const direction of ['outbound', 'return'] as const) {
    const [fromCrs, toCrs] = direction === 'outbound' ? [c.homeCrs, c.workCrs] : [c.workCrs, c.homeCrs];
    const i = calls.findIndex((x) => x.crs === fromCrs && x.activity !== 'pass' && x.activity !== 'destination');
    if (i < 0) continue;
    const j = calls.findIndex((x, k) => k > i && x.crs === toCrs && x.activity !== 'pass');
    if (j < 0) continue;
    const sched = calls[i]!.departure.scheduled;
    if (!sched) continue;
    const travelDate = travelDayFor(new Date(sched), direction === 'outbound' ? c.outbound : c.return);
    if (!travelDate || !maskHasDay(c.activeDaysMask, weekdayOf(travelDate))) continue;
    return { commuteId: c.commuteId, direction, from: calls[i]!, to: calls[j]!, travelDate };
  }
  return null;
}

/** Whether `now` falls inside the quiet hours (London wall-clock; may wrap midnight). */
export function inQuietHours(now: Date, quiet: { start: string; end: string } | null): boolean {
  if (!quiet) return false;
  return inLocalWindow(toLondon(now).time.slice(0, 5), quiet.start.slice(0, 5), quiet.end.slice(0, 5));
}

/** Whether a leg is still worth alerting about: not yet departed and not long overdue. */
export function legIsLive(leg: Leg, now: Date, cfg: AlertConfig = DEFAULT_ALERT_CONFIG): boolean {
  if (leg.from.departure.isActual) return false;
  const due = leg.from.departure.expected ?? leg.from.departure.scheduled;
  if (!due) return false;
  return now.getTime() <= new Date(due).getTime() + cfg.staleAfterMin * 60_000;
}

/**
 * Normalised alert values. Each type has at most one current value; null means
 * "nothing to say" (and nothing was previously said that needs correcting).
 *  platform_change:      `plat:<platform>`
 *  cancellation:         `cancel:full` | `cancel:dest` | `reinstated`
 *  delay:                `delay:<minutes>` | `delay:recovered`
 *  predicted_disruption: `risk:medium` | `risk:high` | `risk:low` (only after a warning)
 */
export function currentValue(
  type: AlertType,
  leg: Leg,
  ctx: { delayThresholdMin: number; risk?: RiskLevel | null },
  lastSent: string | null,
): string | null {
  switch (type) {
    case 'platform_change': {
      const p = leg.from.platform;
      if (!p) return null;
      // Alert on a change; once alerted, keep tracking (including a change back).
      if (leg.from.platformChanged || lastSent) return `plat:${p}`;
      return null;
    }
    case 'cancellation': {
      if (leg.from.isCancelled) return 'cancel:full';
      if (leg.to.isCancelled) return 'cancel:dest';
      return lastSent && lastSent !== 'reinstated' ? 'reinstated' : null;
    }
    case 'delay': {
      if (leg.from.isCancelled) return null;
      const d = journeyStatus(leg.from, leg.to).delayMin;
      if (d !== null && d >= ctx.delayThresholdMin) return `delay:${d}`;
      return lastSent && lastSent !== 'delay:recovered' ? 'delay:recovered' : null;
    }
    case 'predicted_disruption': {
      const r = ctx.risk ?? null;
      if (r === 'medium' || r === 'high') return `risk:${r}`;
      return lastSent && lastSent !== 'risk:low' ? 'risk:low' : null;
    }
  }
}

/** Whether `current` is materially different from what was last sent. */
export function shouldSend(type: AlertType, current: string | null, lastSent: string | null, cfg: AlertConfig = DEFAULT_ALERT_CONFIG): boolean {
  if (current === null || current === lastSent) return false;
  if (type === 'delay' && lastSent?.startsWith('delay:') && current.startsWith('delay:')) {
    const a = Number(lastSent.slice(6));
    const b = Number(current.slice(6));
    if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(b - a) >= cfg.materialDelayDeltaMin;
  }
  return true;
}

export interface AlertDecision {
  type: AlertType;
  value: string;
  previous: string | null;
}

/**
 * Everything to send for one leg now. `lastSent` maps alert type to the last
 * value sent for this user and service.
 */
export function decideAlerts(args: {
  leg: Leg;
  settings: CommuteForAlerts['settings'];
  now: Date;
  lastSent: Partial<Record<AlertType, string>>;
  risk?: RiskLevel | null;
  cfg?: AlertConfig;
}): AlertDecision[] {
  const { leg, settings, now, lastSent } = args;
  const cfg = args.cfg ?? DEFAULT_ALERT_CONFIG;
  if (!settings.enabled || inQuietHours(now, settings.quietHours)) return [];
  // Once the train has left, only "it won't reach your station" still matters (until it arrives).
  const onBoard = leg.from.departure.isActual && !leg.to.arrival.isActual;
  if (!onBoard && !legIsLive(leg, now, cfg)) return [];
  const out: AlertDecision[] = [];
  for (const type of settings.types) {
    if (onBoard && type !== 'cancellation') continue;
    // A cancellation makes other alerts about the same train noise.
    if (type !== 'cancellation' && leg.from.isCancelled) continue;
    const previous = lastSent[type] ?? null;
    const value = currentValue(type, leg, { delayThresholdMin: settings.delayThresholdMin, risk: args.risk }, previous);
    if (shouldSend(type, value, previous, cfg)) out.push({ type, value: value!, previous });
  }
  return out;
}
