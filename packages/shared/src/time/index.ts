/**
 * Time handling. Every instant is stored and passed around as UTC; wall-clock
 * values (timetable times, commute windows, quiet hours) are Europe/London.
 *
 * Rail timetables express times as local HH:MM[:SS] relative to a service
 * start date (SSD). Converting them to instants must handle:
 *  - services that cross midnight (a later call has an earlier clock time),
 *  - the BST/GMT changes (a missing hour in March, a repeated hour in October).
 */

export const LONDON = 'Europe/London';

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface LocalTime {
  h: number;
  m: number;
  s: number;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseLocalTime(value: string): LocalTime {
  const m = TIME_RE.exec(value);
  if (!m) throw new Error(`Invalid local time: ${value}`);
  return { h: Number(m[1]), m: Number(m[2]), s: m[3] ? Number(m[3]) : 0 };
}

export function secondsOfDay(t: LocalTime): number {
  return t.h * 3600 + t.m * 60 + t.s;
}

function parseDate(value: string): { y: number; mo: number; d: number } {
  const m = DATE_RE.exec(value);
  if (!m) throw new Error(`Invalid date: ${value}`);
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
}

/** Adds whole days to a YYYY-MM-DD calendar date. */
export function addDays(date: string, days: number): string {
  const { y, mo, d } = parseDate(date);
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
});

const WEEKDAYS: Record<string, IsoWeekday> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export interface LondonParts {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM:SS
  weekday: IsoWeekday;
  secondsOfDay: number;
}

/** Wall-clock parts of an instant in Europe/London. */
export function toLondon(instant: Date): LondonParts {
  const p: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(instant)) p[part.type] = part.value;
  const time = `${p.hour}:${p.minute}:${p.second}`;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time,
    weekday: WEEKDAYS[p.weekday!]!,
    secondsOfDay: secondsOfDay(parseLocalTime(time)),
  };
}

/** Offset of Europe/London from UTC at an instant, in milliseconds (0 or 3_600_000). */
export function londonOffsetMs(instant: Date): number {
  const p = toLondon(instant);
  const { y, mo, d } = parseDate(p.date);
  const t = parseLocalTime(p.time);
  const asUtc = Date.UTC(y, mo - 1, d, t.h, t.m, t.s);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Every instant at which London wall-clock shows `date time`.
 * Normally one; two during the October repeated hour; none during the March gap.
 */
export function londonCandidates(date: string, time: string | LocalTime): Date[] {
  const { y, mo, d } = parseDate(date);
  const t = typeof time === 'string' ? parseLocalTime(time) : time;
  const naive = Date.UTC(y, mo - 1, d, t.h, t.m, t.s);
  const out: Date[] = [];
  // London is only ever UTC+0 or UTC+1: try both offsets.
  for (const offset of [3_600_000, 0]) {
    const candidate = new Date(naive - offset);
    if (londonOffsetMs(candidate) === offset) out.push(candidate);
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Resolves a London wall-clock time to an instant.
 * - Repeated hour (October): `prefer` picks the earlier (BST) or later (GMT) instant.
 * - Missing hour (March): the time is shifted forward by an hour, matching
 *   how a clock that "doesn't show" 01:30 would read once it springs forward.
 */
export function fromLondon(date: string, time: string | LocalTime, prefer: 'earlier' | 'later' = 'earlier'): Date {
  const candidates = londonCandidates(date, time);
  if (candidates.length > 0) return prefer === 'earlier' ? candidates[0]! : candidates[candidates.length - 1]!;
  const { y, mo, d } = parseDate(date);
  const t = typeof time === 'string' ? parseLocalTime(time) : time;
  // Interpreting the wall time as UTC (GMT) lands an hour after the gap starts, i.e. shifted forward.
  return new Date(Date.UTC(y, mo - 1, d, t.h, t.m, t.s));
}

/** Midnight at the start of a London calendar date, as an instant. */
export function startOfLondonDay(date: string): Date {
  return fromLondon(date, '00:00');
}

export interface TimelineConfig {
  /**
   * If a time is earlier than the previous one in the sequence by more than
   * this many hours, it is treated as having crossed midnight (next day).
   * Smaller backwards steps are treated as the same day (e.g. a forecast that
   * is earlier than a previous scheduled time).
   *
   * RAIL-DATA-CONFIRM: the official rollover rule used by Darwin must be
   * confirmed against its documentation; this default is a placeholder.
   */
  rolloverHours: number;
}

export const DEFAULT_TIMELINE_CONFIG: TimelineConfig = { rolloverHours: 6 };

/**
 * Resolves an ordered sequence of local times (e.g. a calling pattern) on a
 * service start date into instants. Handles crossing midnight (possibly more
 * than once) and BST changes; within the October repeated hour, the instant
 * that keeps the sequence non-decreasing is chosen.
 *
 * `null` entries are passed through (calls without that time).
 */
export function resolveTimeline(
  ssd: string,
  times: ReadonlyArray<string | null>,
  config: TimelineConfig = DEFAULT_TIMELINE_CONFIG,
): Array<Date | null> {
  let dayOffset = 0;
  let prevSeconds: number | null = null;
  let prevInstant: Date | null = null;
  return times.map((value) => {
    if (value === null) return null;
    const t = parseLocalTime(value);
    const secs = secondsOfDay(t);
    if (prevSeconds !== null && prevSeconds - secs > config.rolloverHours * 3600) dayOffset += 1;
    const date = addDays(ssd, dayOffset);
    const candidates = londonCandidates(date, t);
    let instant: Date;
    if (candidates.length === 0) {
      instant = fromLondon(date, t);
    } else {
      instant =
        candidates.find((c) => prevInstant === null || c.getTime() >= prevInstant.getTime()) ??
        candidates[candidates.length - 1]!;
    }
    prevSeconds = secs;
    prevInstant = instant;
    return instant;
  });
}

/**
 * Resolves one local time (e.g. a forecast) relative to a known reference
 * instant (e.g. the scheduled time of the same call), choosing the instant
 * closest to the reference. Used when a feed gives a bare HH:MM.
 */
export function resolveNear(reference: Date, time: string): Date {
  const refDate = toLondon(reference).date;
  const candidates = [-1, 0, 1].flatMap((d) => londonCandidates(addDays(refDate, d), time));
  if (candidates.length === 0) return fromLondon(refDate, time);
  return candidates.reduce((best, c) =>
    Math.abs(c.getTime() - reference.getTime()) < Math.abs(best.getTime() - reference.getTime()) ? c : best,
  );
}

/** Whole minutes from `a` to `b` (positive when b is later), rounded toward zero. */
export function minutesBetween(a: Date, b: Date): number {
  return Math.trunc((b.getTime() - a.getTime()) / 60_000);
}

/**
 * Whether a London wall-clock time lies within [start, end). A window whose end
 * is before its start wraps midnight (e.g. quiet hours 22:00–06:30).
 * A window with start === end is treated as empty.
 */
export function inLocalWindow(time: string, start: string, end: string): boolean {
  const t = secondsOfDay(parseLocalTime(time));
  const s = secondsOfDay(parseLocalTime(start));
  const e = secondsOfDay(parseLocalTime(end));
  if (s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/** Bitmask of ISO weekdays (Mon = bit 0 … Sun = bit 6). */
export function weekdayMask(days: ReadonlyArray<IsoWeekday>): number {
  return days.reduce((mask, d) => mask | (1 << (d - 1)), 0);
}

export function weekdaysFromMask(mask: number): IsoWeekday[] {
  return ([1, 2, 3, 4, 5, 6, 7] as const).filter((d) => (mask & (1 << (d - 1))) !== 0);
}

export function maskHasDay(mask: number, day: IsoWeekday): boolean {
  return (mask & (1 << (day - 1))) !== 0;
}

/** HH:MM in London for display. */
export function formatLondonHm(instant: Date): string {
  return toLondon(instant).time.slice(0, 5);
}
