import { fromLondon, minutesBetween, type DarwinEvent, type NetworkEvent } from '@mct/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { SimClock } from '../src/lib/clock.ts';
import { MockDarwinFeed } from '../src/feeds/darwin/mock.ts';
import { MockHspClient } from '../src/feeds/hsp/mock.ts';
import { MockIncidentsFeed } from '../src/feeds/incidents/mock.ts';
import { ScenarioLibrary } from '../src/feeds/mock/library.ts';
import { reduce } from '../src/feeds/mock/state.ts';
import { MockNetworkRailFeed } from '../src/feeds/network-rail/mock.ts';
import { createFeeds } from '../src/feeds/index.ts';

const DAY = '2026-11-10'; // a Tuesday in GMT
let lib: ScenarioLibrary;

beforeAll(async () => {
  lib = await ScenarioLibrary.load();
});

const at = (date: string, time: string) => fromLondon(date, time);
const stateAt = (instant: Date, dates = lib.datesAround(instant)) =>
  reduce(lib.darwinEvents(dates).filter((e) => e.at <= instant.toISOString()));
const call = (s: ReturnType<typeof stateAt>, feedId: string, tiploc: string) => {
  const c = s.get(feedId)?.calls.find((x) => x.tiploc === tiploc);
  if (!c) throw new Error(`${feedId} ${tiploc} missing`);
  return c;
};

describe('scenario fixtures', () => {
  it('all load and compile on an ordinary day', () => {
    expect(lib.names).toEqual(
      expect.arrayContaining(['on-time', 'progressive-delay', 'platform-change', 'cancellations', 'forming-delay', 'upstream-incident', 'late-night', 'bst-change']),
    );
    const compiled = lib.forDate(DAY);
    expect(compiled.map((c) => c.name)).not.toContain('bst-change'); // fixed-date scenario
    for (const c of compiled) expect(c.darwin.length).toBeGreaterThan(0);
  });

  it('resolves scheduled times to UTC on the scenario date', () => {
    const s = stateAt(at(DAY, '06:00'));
    expect(call(s, `mock:${DAY}:MK1001`, 'NWCSTLE').schedDep).toBe('2026-11-10T07:05:00.000Z');
    // Same fixture in summer is an hour earlier in UTC.
    const summer = '2026-07-14';
    const ss = stateAt(at(summer, '06:00'));
    expect(call(ss, `mock:${summer}:MK1001`, 'NWCSTLE').schedDep).toBe('2026-07-14T06:05:00.000Z');
  });

  it('replays a platform change', () => {
    const before = stateAt(at(DAY, '07:21'));
    const after = stateAt(at(DAY, '07:22'));
    expect(call(before, `mock:${DAY}:MK3001`, 'NWCSTLE').platform).toBe('2');
    expect(call(after, `mock:${DAY}:MK3001`, 'NWCSTLE')).toMatchObject({ platform: '4', platformBooked: '2', platformConfirmed: true });
  });

  it('replays full and part cancellations with reasons', () => {
    const s = stateAt(at(DAY, '09:00'));
    const full = s.get(`mock:${DAY}:MK4001`)!;
    expect(full.isCancelled).toBe(true);
    expect(full.cancelReason).toMatch(/crew/);
    const part = s.get(`mock:${DAY}:MK4002`)!;
    expect(part.isCancelled).toBe(false);
    expect(call(s, part.service.feedId, 'YORK').isCancelled).toBe(true);
    expect(call(s, part.service.feedId, 'DRLNGTN').isCancelled).toBe(false);
  });

  it('links the late inbound working to the service it forms', () => {
    const s = stateAt(at(DAY, '07:50'));
    const inbound = s.get(`mock:${DAY}:MK5000`)!;
    expect(inbound.associations).toEqual([{ assocFeedId: `mock:${DAY}:MK5001`, association: 'forms', tiploc: 'NWCSTLE' }]);
    const eta = new Date(call(s, inbound.service.feedId, 'NWCSTLE').fcstArr!);
    const outbound = call(s, `mock:${DAY}:MK5001`, 'NWCSTLE');
    // The outbound forecast hasn't caught up yet: that's what the forming-service rule will spot.
    expect(outbound.fcstDep).toBeNull();
    expect(minutesBetween(new Date(outbound.schedDep!), eta)).toBe(7);
  });

  it('handles a service that crosses midnight', () => {
    const next = '2026-11-11';
    const s = stateAt(at(next, '01:00'));
    const york = call(s, `mock:${DAY}:MK7001`, 'YORK');
    expect(york.schedArr).toBe('2026-11-11T00:38:00.000Z');
    expect(minutesBetween(new Date(york.schedArr!), new Date(york.actualArr!))).toBe(5);
  });

  it('handles the October clock change (repeated hour)', () => {
    const s = stateAt(new Date('2026-10-25T03:00:00Z'), ['2026-10-24']);
    const feedId = 'mock:2026-10-24:MK8001';
    const durham = call(s, feedId, 'DRHM');
    const ncl = call(s, feedId, 'NWCSTLE');
    expect(durham.schedArr).toBe('2026-10-25T00:10:00.000Z'); // 01:10 BST
    expect(durham.actualArr).toBe('2026-10-25T00:25:00.000Z'); // 01:25 BST
    expect(ncl.schedArr).toBe('2026-10-25T00:50:00.000Z'); // 01:50 BST
    expect(ncl.actualArr).toBe('2026-10-25T01:10:00.000Z'); // 01:10 GMT, after the clocks went back
    expect(minutesBetween(new Date(ncl.schedArr!), new Date(ncl.actualArr!))).toBe(20);
  });
});

describe('MockDarwinFeed', () => {
  it('catches up on start, then emits events as the clock reaches them, once each', async () => {
    const clock = new SimClock(at(DAY, '07:21'));
    const feed = new MockDarwinFeed(lib, clock);
    const seen: DarwinEvent[] = [];
    feed.onEvent(async (e) => void seen.push(e));
    await feed.tick();
    const caughtUp = seen.length;
    expect(seen.some((e) => e.kind === 'schedule')).toBe(true);
    expect(seen.every((e) => e.at <= clock.now().toISOString())).toBe(true);

    await feed.tick();
    expect(seen.length).toBe(caughtUp); // nothing new, no repeats

    clock.advance(60_000); // 07:22: the platform change
    await feed.tick();
    const fresh = seen.slice(caughtUp);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({ kind: 'update', feedId: `mock:${DAY}:MK3001` });
    expect(feed.health()).toMatchObject({ name: 'darwin', mode: 'mock' });
  });

  it('snapshots only services calling at the requested stations in the window', async () => {
    const clock = new SimClock(at(DAY, '08:00'));
    const feed = new MockDarwinFeed(lib, clock);
    const events: DarwinEvent[] = [];
    for await (const e of feed.snapshot(['NCL'], at(DAY, '07:00'), at(DAY, '07:30'))) events.push(e);
    const ids = new Set(events.flatMap((e) => (e.kind === 'schedule' ? [e.service.feedId] : [])));
    expect(ids).toEqual(new Set([`mock:${DAY}:MK1001`, `mock:${DAY}:MK2001`]));
    expect(events.every((e) => e.at <= clock.now().toISOString())).toBe(true);
  });
});

describe('other mock feeds', () => {
  it('replays network events', async () => {
    const clock = new SimClock(at(DAY, '09:15'));
    const feed = new MockNetworkRailFeed(lib, clock);
    const seen: NetworkEvent[] = [];
    feed.onEvent(async (e) => void seen.push(e));
    await feed.tick();
    expect(seen.filter((e) => e.at.startsWith(DAY))).toHaveLength(3);
    expect(seen.find((e) => e.kind === 'movement' && e.feedId && e.at.startsWith(DAY))).toMatchObject({ feedId: `mock:${DAY}:MK6001` });
  });

  it('serves incidents only while active', async () => {
    const feed = new MockIncidentsFeed(lib);
    expect(await feed.fetchActive(at(DAY, '08:00'))).toHaveLength(0);
    const active = await feed.fetchActive(at(DAY, '09:00'));
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ affectedCrs: ['DAR'] });
    expect(await feed.fetchActive(at(DAY, '10:30'))).toHaveLength(0);
  });

  it('serves HSP history from the scenarios’ final state', async () => {
    const hsp = new MockHspClient(lib);
    const summaries = await hsp.serviceMetrics({
      fromCrs: 'NCL', toCrs: 'YRK', fromDate: '2026-11-09', toDate: '2026-11-10',
      fromTime: '07:00', toTime: '08:00', days: 'weekday',
    });
    expect(summaries.filter((s) => s.serviceRef.includes(DAY)).map((s) => s.schedDepLocal)).toEqual(['07:05', '07:25', '07:40']);
    const detail = await hsp.serviceDetails(`mock:${DAY}:MK2001`);
    const york = detail.calls.find((c) => c.crs === 'YRK')!;
    expect(minutesBetween(new Date(york.schedArr!), new Date(york.actualArr!))).toBe(14);
  });

  it('builds mock feeds from env and refuses unknown modes', async () => {
    const feeds = await createFeeds({ MOCK_CLOCK_START: '2026-11-10T08:00:00Z' });
    expect(feeds.clock.now().toISOString() >= '2026-11-10T08:00:00.000Z').toBe(true);
    expect(feeds.scenarios.length).toBeGreaterThan(0);
    await expect(createFeeds({ DARWIN_MODE: 'nope' })).rejects.toThrow(/DARWIN_MODE/);
  });
});
