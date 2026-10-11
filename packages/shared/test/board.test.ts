import { describe, expect, it } from 'vitest';
import { callView, journeyStatus, timeView, type StoredCall } from '../src/board.ts';

const d = (hm: string) => new Date(`2026-11-10T${hm}:00Z`);
const base: StoredCall = {
  tiploc: 'X', crs: 'XXX', activity: 'stop',
  schedArr: null, schedDep: null, fcstArr: null, fcstDep: null, actualArr: null, actualDep: null,
  platform: '1', platformBooked: '1', platformConfirmed: false,
  isCancelled: false, cancelReason: null, delayReason: null,
};
const from = (o: Partial<StoredCall> = {}) => callView({ ...base, schedDep: d('07:00'), ...o }, 'From');
const to = (o: Partial<StoredCall> = {}) => callView({ ...base, schedArr: d('08:00'), ...o }, 'To');

describe('timeView', () => {
  it('prefers actual over forecast and computes delay', () => {
    expect(timeView(d('07:00'), d('07:05'), null)).toMatchObject({ expected: '2026-11-10T07:05:00.000Z', isActual: false, delayMin: 5 });
    expect(timeView(d('07:00'), d('07:05'), d('07:03'))).toMatchObject({ isActual: true, delayMin: 3 });
    expect(timeView(d('07:00'), null, null)).toMatchObject({ expected: null, delayMin: null });
  });

  it('computes delay across midnight', () => {
    expect(timeView(new Date('2026-11-10T23:55:00Z'), new Date('2026-11-11T00:07:00Z'), null).delayMin).toBe(12);
  });
});

describe('callView', () => {
  it('flags platform changes and picks the right reason', () => {
    expect(from({ platform: '4', platformBooked: '2' }).platformChanged).toBe(true);
    expect(from({ platform: '2', platformBooked: '2' }).platformChanged).toBe(false);
    expect(from({ platform: null, platformBooked: '2' }).platformChanged).toBe(false);
    expect(from({ isCancelled: true, cancelReason: 'crew', delayReason: 'late' }).reason).toBe('crew');
    expect(from({ delayReason: 'late' }).reason).toBe('late');
  });
});

describe('journeyStatus', () => {
  it('is on time with no reports', () => {
    expect(journeyStatus(from(), to())).toEqual({ status: 'on_time', progress: 'scheduled', delayMin: null });
  });

  it('is delayed from forecasts, by departure before departing and by arrival after', () => {
    expect(journeyStatus(from({ fcstDep: d('07:04') }), to({ fcstArr: d('08:10') }))).toMatchObject({ status: 'delayed', delayMin: 4 });
    expect(journeyStatus(from({ actualDep: d('07:04') }), to({ fcstArr: d('08:10') }))).toMatchObject({ status: 'delayed', progress: 'departed', delayMin: 10 });
    expect(journeyStatus(from({ actualDep: d('07:00') }), to({ actualArr: d('08:00') }))).toMatchObject({ status: 'on_time', progress: 'arrived', delayMin: 0 });
  });

  it('is cancelled or part-cancelled', () => {
    expect(journeyStatus(from({ isCancelled: true }), to({ isCancelled: true })).status).toBe('cancelled');
    expect(journeyStatus(from(), to({ isCancelled: true })).status).toBe('part_cancelled');
  });

  it('respects the delayed threshold', () => {
    expect(journeyStatus(from({ fcstDep: d('07:02') }), to(), { delayedFromMin: 3 }).status).toBe('on_time');
  });
});
