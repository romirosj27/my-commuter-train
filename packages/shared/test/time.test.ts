import { describe, expect, it } from 'vitest';
import {
  fromLondon,
  inLocalWindow,
  londonCandidates,
  maskHasDay,
  minutesBetween,
  resolveNear,
  resolveTimeline,
  toLondon,
  weekdayMask,
  weekdaysFromMask,
} from '../src/time/index.ts';

const iso = (d: Date | null) => d?.toISOString() ?? null;

describe('fromLondon / toLondon', () => {
  it('uses GMT in winter and BST in summer', () => {
    expect(iso(fromLondon('2026-01-15', '08:00'))).toBe('2026-01-15T08:00:00.000Z');
    expect(iso(fromLondon('2026-07-15', '08:00'))).toBe('2026-07-15T07:00:00.000Z');
  });

  it('round-trips through London parts', () => {
    const p = toLondon(new Date('2026-07-15T07:00:00Z'));
    expect(p).toMatchObject({ date: '2026-07-15', time: '08:00:00', weekday: 3 });
  });

  it('has two instants for the repeated hour in October', () => {
    const c = londonCandidates('2026-10-25', '01:30').map(iso);
    expect(c).toEqual(['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z']);
    expect(iso(fromLondon('2026-10-25', '01:30', 'later'))).toBe('2026-10-25T01:30:00.000Z');
  });

  it('shifts a time in the March gap forward', () => {
    expect(londonCandidates('2027-03-28', '01:30')).toEqual([]);
    expect(iso(fromLondon('2027-03-28', '01:30'))).toBe('2027-03-28T01:30:00.000Z');
    expect(toLondon(fromLondon('2027-03-28', '01:30')).time).toBe('02:30:00');
  });
});

describe('resolveTimeline', () => {
  it('rolls over midnight within a calling pattern', () => {
    const r = resolveTimeline('2026-01-15', ['23:40', '23:58', null, '00:12', '00:40']).map(iso);
    expect(r).toEqual([
      '2026-01-15T23:40:00.000Z',
      '2026-01-15T23:58:00.000Z',
      null,
      '2026-01-16T00:12:00.000Z',
      '2026-01-16T00:40:00.000Z',
    ]);
  });

  it('does not roll over for a small backwards step', () => {
    const r = resolveTimeline('2026-01-15', ['08:10', '08:05']).map(iso);
    expect(r).toEqual(['2026-01-15T08:10:00.000Z', '2026-01-15T08:05:00.000Z']);
  });

  it('crosses midnight into the October clock change and stays monotonic', () => {
    // SSD Saturday 24 Oct 2026; clocks go back at 02:00 BST on Sunday 25th.
    const r = resolveTimeline('2026-10-24', ['23:50', '00:30', '01:20', '01:40', '01:10', '02:15']).map(iso);
    expect(r).toEqual([
      '2026-10-24T22:50:00.000Z', // BST
      '2026-10-24T23:30:00.000Z',
      '2026-10-25T00:20:00.000Z', // first 01:20 (BST)
      '2026-10-25T00:40:00.000Z', // first 01:40 (BST)
      '2026-10-25T01:10:00.000Z', // clock went back: second 01:10 (GMT)
      '2026-10-25T02:15:00.000Z', // GMT
    ]);
    // Elapsed time across the change is real time, not clock time.
    expect(minutesBetween(new Date(r[0]!), new Date(r[5]!))).toBe(205);
  });

  it('handles the March clock change across midnight', () => {
    const r = resolveTimeline('2027-03-27', ['23:30', '00:45', '02:15']).map(iso);
    expect(r).toEqual(['2027-03-27T23:30:00.000Z', '2027-03-28T00:45:00.000Z', '2027-03-28T01:15:00.000Z']);
  });
});

describe('resolveNear', () => {
  it('picks the instant nearest the reference, across midnight', () => {
    const sched = new Date('2026-01-15T23:55:00Z');
    expect(iso(resolveNear(sched, '00:07'))).toBe('2026-01-16T00:07:00.000Z');
    expect(iso(resolveNear(sched, '23:50'))).toBe('2026-01-15T23:50:00.000Z');
  });
});

describe('windows and weekdays', () => {
  it('handles plain and wrapping windows', () => {
    expect(inLocalWindow('07:30', '07:00', '09:00')).toBe(true);
    expect(inLocalWindow('09:00', '07:00', '09:00')).toBe(false);
    expect(inLocalWindow('23:30', '22:00', '06:30')).toBe(true);
    expect(inLocalWindow('05:00', '22:00', '06:30')).toBe(true);
    expect(inLocalWindow('12:00', '22:00', '06:30')).toBe(false);
    expect(inLocalWindow('12:00', '12:00', '12:00')).toBe(false);
  });

  it('round-trips weekday masks', () => {
    const mask = weekdayMask([1, 2, 3, 4, 5]);
    expect(mask).toBe(0b0011111);
    expect(weekdaysFromMask(mask)).toEqual([1, 2, 3, 4, 5]);
    expect(maskHasDay(mask, 6)).toBe(false);
  });
});
