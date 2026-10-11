import type { BoardService, CallView, TimeView } from '@mct/shared';

export const tv = (scheduled: string | null, expected: string | null = null, isActual = false): TimeView => ({
  scheduled,
  expected,
  isActual,
  delayMin: scheduled && expected ? Math.trunc((Date.parse(expected) - Date.parse(scheduled)) / 60_000) : null,
});

export const call = (over: Partial<CallView> = {}): CallView => ({
  tiploc: 'X',
  crs: 'NCL',
  name: 'Newcastle',
  activity: 'stop',
  arrival: tv(null),
  departure: tv(null),
  platform: '2',
  platformBooked: '2',
  platformChanged: false,
  platformConfirmed: false,
  isCancelled: false,
  reason: null,
  ...over,
});

export const service = (over: Partial<BoardService> = {}): BoardService => ({
  serviceId: crypto.randomUUID(),
  headcode: '1M01',
  toc: 'TP',
  operator: 'TransPennine Express',
  origin: 'Newcastle',
  destination: 'York',
  from: call({ departure: tv('2026-11-10T07:05:00Z') }),
  to: call({ crs: 'YRK', name: 'York', arrival: tv('2026-11-10T08:08:00Z') }),
  status: 'on_time',
  progress: 'scheduled',
  delayMin: null,
  reason: null,
  ...over,
});
