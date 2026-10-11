import { formatLondonHm, type BoardService, type CallView, type RiskLevel, type ServiceStatus, type TimeView } from '@mct/shared';

export const hm = (iso: string | null | undefined): string => (iso ? formatLondonHm(new Date(iso)) : '—');

export interface ExpectedText {
  text: string;
  tone: 'ok' | 'late' | 'early' | 'unknown' | 'cancelled';
}

/** What a departure board shows in the "expected" column. */
export function expectedText(t: TimeView, cancelled = false): ExpectedText {
  if (cancelled) return { text: 'Cancelled', tone: 'cancelled' };
  if (!t.scheduled) return { text: '—', tone: 'unknown' };
  if (t.delayMin === null) return { text: 'On time', tone: 'unknown' };
  const prefix = t.isActual ? '' : 'Exp ';
  if (t.delayMin >= 1) return { text: `${prefix}${hm(t.expected)}`, tone: 'late' };
  if (t.delayMin <= -1) return { text: `${prefix}${hm(t.expected)}`, tone: 'early' };
  return { text: t.isActual ? 'On time' : 'On time', tone: 'ok' };
}

export function delayLabel(min: number | null): string | null {
  if (min === null || min === 0) return null;
  if (min > 0) return `${min} min late`;
  return `${-min} min early`;
}

export const STATUS_LABEL: Record<ServiceStatus, string> = {
  on_time: 'On time',
  delayed: 'Delayed',
  cancelled: 'Cancelled',
  part_cancelled: "Doesn't reach your station",
};

export const STATUS_BADGE: Record<ServiceStatus, 'success' | 'warning' | 'destructive'> = {
  on_time: 'success',
  delayed: 'warning',
  cancelled: 'destructive',
  part_cancelled: 'destructive',
};

export const RISK_LABEL: Record<RiskLevel, string> = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' };
export const RISK_BADGE: Record<RiskLevel, 'secondary' | 'warning' | 'destructive'> = {
  low: 'secondary',
  medium: 'warning',
  high: 'destructive',
};

/** Short status line for a board row. */
export function statusLine(s: BoardService): string {
  if (s.status === 'cancelled') return 'Cancelled';
  if (s.status === 'part_cancelled') return `Terminates before ${s.to.name}`;
  const d = delayLabel(s.delayMin);
  if (s.progress === 'arrived') return d ? `Arrived ${d}` : 'Arrived on time';
  if (s.progress === 'departed') return d ? `Departed · ${d}` : 'Departed · on time';
  return d ?? 'On time';
}

export function platformText(c: CallView): string {
  return c.platform ?? '—';
}
