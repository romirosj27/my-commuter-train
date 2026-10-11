import { describe, expect, it } from 'vitest';
import {
  decideAlerts,
  inQuietHours,
  legIsLive,
  matchLeg,
  shouldSend,
  travelDayFor,
  type CommuteForAlerts,
  type Leg,
} from '../src/alerts.ts';
import type { CallView, TimeView } from '../src/board.ts';
import { fromLondon } from '../src/time/index.ts';

const tv = (scheduled: Date | null, expected: Date | null = null, isActual = false): TimeView => ({
  scheduled: scheduled?.toISOString() ?? null,
  expected: expected?.toISOString() ?? null,
  isActual,
  delayMin: scheduled && expected ? Math.trunc((expected.getTime() - scheduled.getTime()) / 60_000) : null,
});
const L = (date: string, time: string) => fromLondon(date, time);
const TUE = '2026-11-10';

const call = (crs: string, o: Partial<CallView> = {}): CallView => ({
  tiploc: crs, crs, name: crs, activity: 'stop',
  arrival: tv(null), departure: tv(null),
  platform: '1', platformBooked: '1', platformChanged: false, platformConfirmed: false,
  isCancelled: false, reason: null, ...o,
});

const commute = (o: Partial<CommuteForAlerts> = {}): CommuteForAlerts => ({
  commuteId: 'c1', userId: 'u1', homeCrs: 'NCL', workCrs: 'YRK',
  outbound: { start: '07:00', end: '09:00' }, return: { start: '17:00', end: '19:00' },
  activeDaysMask: 0b0011111, operatorCodes: [],
  settings: { enabled: true, types: ['platform_change', 'cancellation', 'delay', 'predicted_disruption'], delayThresholdMin: 5, quietHours: null },
  ...o,
});

const pattern = (dep: Date, o: { from?: Partial<CallView>; to?: Partial<CallView> } = {}) => [
  call('NCL', { activity: 'origin', departure: tv(dep), ...o.from }),
  call('DHM', { departure: tv(new Date(dep.getTime() + 12 * 60_000)) }),
  call('YRK', { activity: 'destination', arrival: tv(new Date(dep.getTime() + 60 * 60_000)), ...o.to }),
];

describe('travelDayFor', () => {
  it('assigns departures to the day their window opened', () => {
    expect(travelDayFor(L(TUE, '07:30'), { start: '07:00', end: '09:00' })).toBe(TUE);
    expect(travelDayFor(L(TUE, '09:00'), { start: '07:00', end: '09:00' })).toBeNull();
    expect(travelDayFor(L(TUE, '23:30'), { start: '22:00', end: '01:00' })).toBe(TUE);
    expect(travelDayFor(L('2026-11-11', '00:30'), { start: '22:00', end: '01:00' })).toBe(TUE);
  });

  it('uses London time across the clock change', () => {
    // 07:30 BST in July is 06:30 UTC; still inside a 07:00–09:00 window.
    expect(travelDayFor(new Date('2026-07-14T06:30:00Z'), { start: '07:00', end: '09:00' })).toBe('2026-07-14');
    expect(travelDayFor(new Date('2026-07-14T07:30:00Z'), { start: '07:00', end: '09:00' })).toBe('2026-07-14');
    expect(travelDayFor(new Date('2026-07-14T08:30:00Z'), { start: '07:00', end: '09:00' })).toBeNull(); // 09:30 BST
  });
});

describe('matchLeg', () => {
  it('matches outbound and return in the right order', () => {
    expect(matchLeg(commute(), 'TP', pattern(L(TUE, '07:30')))).toMatchObject({ direction: 'outbound', travelDate: TUE });
    const back = [call('YRK', { departure: tv(L(TUE, '17:20')) }), call('NCL', { arrival: tv(L(TUE, '18:20')) })];
    expect(matchLeg(commute(), 'TP', back)).toMatchObject({ direction: 'return' });
    // A York→Newcastle train in the morning isn't in the return window.
    const wrongWay = [call('YRK', { departure: tv(L(TUE, '07:30')) }), call('NCL', { arrival: tv(L(TUE, '08:30')) })];
    expect(matchLeg(commute(), 'TP', wrongWay)).toBeNull();
  });

  it('respects operators, windows and active days', () => {
    expect(matchLeg(commute({ operatorCodes: ['GR'] }), 'TP', pattern(L(TUE, '07:30')))).toBeNull();
    expect(matchLeg(commute(), 'TP', pattern(L(TUE, '09:15')))).toBeNull();
    expect(matchLeg(commute(), 'TP', pattern(L('2026-11-14', '07:30')))).toBeNull(); // Saturday
  });

  it('counts an after-midnight departure towards the previous day', () => {
    const c = commute({ return: { start: '23:00', end: '01:00' }, activeDaysMask: 0b0010000 }); // Fridays only
    const fri = '2026-11-13';
    const back = [call('YRK', { departure: tv(L('2026-11-14', '00:20')) }), call('NCL', { arrival: tv(L('2026-11-14', '01:20')) })];
    expect(matchLeg(c, 'GR', back)).toMatchObject({ direction: 'return', travelDate: fri });
  });
});

describe('quiet hours', () => {
  it('handles windows that wrap midnight, in London time', () => {
    const q = { start: '22:00', end: '06:30' };
    expect(inQuietHours(L(TUE, '23:15'), q)).toBe(true);
    expect(inQuietHours(L(TUE, '06:29'), q)).toBe(true);
    expect(inQuietHours(L(TUE, '06:30'), q)).toBe(false);
    expect(inQuietHours(L(TUE, '12:00'), q)).toBe(false);
    expect(inQuietHours(L(TUE, '12:00'), null)).toBe(false);
    // Stored times may carry seconds.
    expect(inQuietHours(L(TUE, '23:15'), { start: '22:00:00', end: '06:30:00' })).toBe(true);
  });

  it('suppresses all alerts during quiet hours', () => {
    const leg = matchLeg(commute(), 'TP', pattern(L(TUE, '07:30'), { from: { isCancelled: true } }))!;
    const settings = { ...commute().settings, quietHours: { start: '06:00', end: '07:15' } };
    expect(decideAlerts({ leg, settings, now: L(TUE, '07:00'), lastSent: {} })).toEqual([]);
    expect(decideAlerts({ leg, settings, now: L(TUE, '07:16'), lastSent: {} })).toHaveLength(1);
  });
});

describe('decideAlerts and dedupe', () => {
  const settings = commute().settings;
  const legWith = (o: { from?: Partial<CallView>; to?: Partial<CallView> }) => matchLeg(commute(), 'TP', pattern(L(TUE, '07:30'), o))!;
  const now = L(TUE, '07:00');

  it('sends a platform change once, then follow-ups only when it changes again', () => {
    const changed = legWith({ from: { platform: '4', platformBooked: '2', platformChanged: true } });
    expect(decideAlerts({ leg: changed, settings, now, lastSent: {} })).toEqual([{ type: 'platform_change', value: 'plat:4', previous: null }]);
    expect(decideAlerts({ leg: changed, settings, now, lastSent: { platform_change: 'plat:4' } })).toEqual([]);
    const again = legWith({ from: { platform: '6', platformBooked: '2', platformChanged: true } });
    expect(decideAlerts({ leg: again, settings, now, lastSent: { platform_change: 'plat:4' } })).toMatchObject([{ value: 'plat:6' }]);
    const back = legWith({ from: { platform: '2', platformBooked: '2' } });
    expect(decideAlerts({ leg: back, settings, now, lastSent: { platform_change: 'plat:6' } })).toMatchObject([{ value: 'plat:2' }]);
    expect(decideAlerts({ leg: back, settings, now, lastSent: {} })).toEqual([]);
  });

  it('sends delays at the threshold, and follow-ups only on material change', () => {
    const late = (min: number) => legWith({ from: { departure: tv(L(TUE, '07:30'), new Date(L(TUE, '07:30').getTime() + min * 60_000)) } });
    expect(decideAlerts({ leg: late(4), settings, now, lastSent: {} })).toEqual([]);
    expect(decideAlerts({ leg: late(5), settings, now, lastSent: {} })).toEqual([{ type: 'delay', value: 'delay:5', previous: null }]);
    expect(decideAlerts({ leg: late(9), settings, now, lastSent: { delay: 'delay:5' } })).toEqual([]);
    expect(decideAlerts({ leg: late(10), settings, now, lastSent: { delay: 'delay:5' } })).toMatchObject([{ value: 'delay:10' }]);
    expect(decideAlerts({ leg: late(6), settings, now, lastSent: { delay: 'delay:12' } })).toMatchObject([{ value: 'delay:6' }]);
    expect(decideAlerts({ leg: late(2), settings, now, lastSent: { delay: 'delay:12' } })).toMatchObject([{ value: 'delay:recovered' }]);
    expect(decideAlerts({ leg: late(2), settings, now, lastSent: { delay: 'delay:recovered' } })).toEqual([]);
  });

  it('sends cancellations, part cancellations and reinstatements, without other noise', () => {
    const full = legWith({ from: { isCancelled: true, platform: '4', platformBooked: '2', platformChanged: true } });
    expect(decideAlerts({ leg: full, settings, now, lastSent: {} })).toEqual([{ type: 'cancellation', value: 'cancel:full', previous: null }]);
    const part = legWith({ to: { isCancelled: true } });
    expect(decideAlerts({ leg: part, settings, now, lastSent: {} })).toMatchObject([{ value: 'cancel:dest' }]);
    const ok = legWith({});
    expect(decideAlerts({ leg: ok, settings, now, lastSent: { cancellation: 'cancel:full' } })).toMatchObject([{ value: 'reinstated' }]);
    expect(decideAlerts({ leg: ok, settings, now, lastSent: { cancellation: 'reinstated' } })).toEqual([]);
  });

  it('only sends enabled types, and nothing when alerts are off', () => {
    const full = legWith({ from: { isCancelled: true } });
    expect(decideAlerts({ leg: full, settings: { ...settings, types: ['delay'] }, now, lastSent: {} })).toEqual([]);
    expect(decideAlerts({ leg: full, settings: { ...settings, enabled: false }, now, lastSent: {} })).toEqual([]);
  });

  it('sends predicted disruption at medium or high risk', () => {
    const leg = legWith({});
    expect(decideAlerts({ leg, settings, now, lastSent: {}, risk: 'low' })).toEqual([]);
    expect(decideAlerts({ leg, settings, now, lastSent: {}, risk: 'medium' })).toMatchObject([{ value: 'risk:medium' }]);
    expect(decideAlerts({ leg, settings, now, lastSent: { predicted_disruption: 'risk:medium' }, risk: 'high' })).toMatchObject([{ value: 'risk:high' }]);
    expect(decideAlerts({ leg, settings, now, lastSent: { predicted_disruption: 'risk:high' }, risk: 'low' })).toMatchObject([{ value: 'risk:low' }]);
  });

  it('stops once the train has departed or is long overdue', () => {
    const departed = legWith({ from: { departure: tv(L(TUE, '07:30'), L(TUE, '07:40'), true), isCancelled: false } });
    expect(legIsLive(departed, L(TUE, '07:41'))).toBe(false);
    const noReport = legWith({});
    expect(legIsLive(noReport, L(TUE, '07:44'))).toBe(true);
    expect(legIsLive(noReport, L(TUE, '07:46'))).toBe(false);
  });

  it('after departure, still warns that the train will not reach your station', () => {
    const settingsAll = commute().settings;
    const onBoard = legWith({ from: { departure: tv(L(TUE, '07:30'), L(TUE, '07:31'), true) }, to: { isCancelled: true } });
    expect(decideAlerts({ leg: onBoard, settings: settingsAll, now: L(TUE, '07:50'), lastSent: {} })).toEqual([{ type: 'cancellation', value: 'cancel:dest', previous: null }]);
    const lateOnBoard = legWith({ from: { departure: tv(L(TUE, '07:30'), L(TUE, '07:45'), true) } });
    expect(decideAlerts({ leg: lateOnBoard, settings: settingsAll, now: L(TUE, '07:50'), lastSent: {} })).toEqual([]);
  });

  it('compares delay values numerically', () => {
    expect(shouldSend('delay', 'delay:14', 'delay:10')).toBe(false);
    expect(shouldSend('delay', 'delay:15', 'delay:10')).toBe(true);
    expect(shouldSend('delay', 'delay:recovered', 'delay:10')).toBe(true);
    expect(shouldSend('delay', null, 'delay:10')).toBe(false);
  });
});
