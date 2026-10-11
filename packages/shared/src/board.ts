/**
 * Board view model: derives what a passenger sees (expected times, platform
 * changes, status, reason) from stored call data. Shared by the API and,
 * later, the alert engine so both describe a service the same way.
 */
import { minutesBetween } from './time/index.ts';

export interface StoredCall {
  tiploc: string;
  crs: string | null;
  activity: 'origin' | 'stop' | 'pass' | 'destination';
  schedArr: Date | null;
  schedDep: Date | null;
  fcstArr: Date | null;
  fcstDep: Date | null;
  actualArr: Date | null;
  actualDep: Date | null;
  platform: string | null;
  platformBooked: string | null;
  platformConfirmed: boolean;
  isCancelled: boolean;
  cancelReason: string | null;
  delayReason: string | null;
}

export interface TimeView {
  scheduled: string | null;
  /** Actual if known, else forecast, else null (no report). */
  expected: string | null;
  isActual: boolean;
  /** Minutes late (negative = early) of `expected` against `scheduled`; null when unknown. */
  delayMin: number | null;
}

export interface CallView {
  tiploc: string;
  crs: string | null;
  name: string;
  activity: StoredCall['activity'];
  arrival: TimeView;
  departure: TimeView;
  platform: string | null;
  platformBooked: string | null;
  platformChanged: boolean;
  platformConfirmed: boolean;
  isCancelled: boolean;
  reason: string | null;
}

export type ServiceStatus = 'on_time' | 'delayed' | 'cancelled' | 'part_cancelled';
export type ServiceProgress = 'scheduled' | 'departed' | 'arrived';

export interface BoardConfig {
  /** A service is "delayed" when it is at least this many minutes late. */
  delayedFromMin: number;
}

export const DEFAULT_BOARD_CONFIG: BoardConfig = { delayedFromMin: 1 };

const iso = (d: Date | null) => d?.toISOString() ?? null;

export function timeView(scheduled: Date | null, forecast: Date | null, actual: Date | null): TimeView {
  const expected = actual ?? forecast;
  return {
    scheduled: iso(scheduled),
    expected: iso(expected),
    isActual: actual !== null,
    delayMin: scheduled && expected ? minutesBetween(scheduled, expected) : null,
  };
}

export function callView(c: StoredCall, name: string): CallView {
  return {
    tiploc: c.tiploc,
    crs: c.crs,
    name,
    activity: c.activity,
    arrival: timeView(c.schedArr, c.fcstArr, c.actualArr),
    departure: timeView(c.schedDep, c.fcstDep, c.actualDep),
    platform: c.platform,
    platformBooked: c.platformBooked,
    platformChanged: c.platform !== null && c.platformBooked !== null && c.platform !== c.platformBooked,
    platformConfirmed: c.platformConfirmed,
    isCancelled: c.isCancelled,
    reason: c.isCancelled ? c.cancelReason : c.delayReason,
  };
}

/**
 * Status of a journey from `from` to `to` on one service.
 * - cancelled: the train does not call at the departure station.
 * - part_cancelled: it departs but does not reach the destination.
 */
export function journeyStatus(
  from: CallView,
  to: CallView,
  cfg: BoardConfig = DEFAULT_BOARD_CONFIG,
): { status: ServiceStatus; progress: ServiceProgress; delayMin: number | null } {
  const progress: ServiceProgress = to.arrival.isActual ? 'arrived' : from.departure.isActual ? 'departed' : 'scheduled';
  if (from.isCancelled) return { status: 'cancelled', progress: 'scheduled', delayMin: null };
  // Lateness that matters to the passenger: at the destination once departed, else at departure.
  const delayMin =
    progress === 'scheduled' ? (from.departure.delayMin ?? to.arrival.delayMin) : (to.arrival.delayMin ?? from.departure.delayMin);
  if (to.isCancelled) return { status: 'part_cancelled', progress, delayMin };
  const late = Math.max(from.departure.delayMin ?? 0, to.arrival.delayMin ?? 0);
  return { status: late >= cfg.delayedFromMin ? 'delayed' : 'on_time', progress, delayMin };
}

export interface BoardService {
  serviceId: string;
  headcode: string | null;
  toc: string;
  operator: string;
  origin: string;
  destination: string;
  from: CallView;
  to: CallView;
  status: ServiceStatus;
  progress: ServiceProgress;
  delayMin: number | null;
  /** Cancellation reason if cancelled, else the most specific delay reason. */
  reason: string | null;
}

export interface ServiceDetail {
  serviceId: string;
  headcode: string | null;
  toc: string;
  operator: string;
  ssd: string;
  origin: string;
  destination: string;
  isCancelled: boolean;
  reason: string | null;
  calls: CallView[];
  /** The inbound service whose unit forms this one, with its arrival where it forms us. */
  formedBy: LinkedService | null;
  /** The service this one goes on to form. */
  forms: LinkedService | null;
}

export interface LinkedService {
  serviceId: string;
  headcode: string | null;
  toc: string;
  origin: string;
  destination: string;
  isCancelled: boolean;
  /** This linked service's call at the association location. */
  at: CallView | null;
}
