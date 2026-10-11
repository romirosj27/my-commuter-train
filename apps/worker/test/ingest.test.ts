/**
 * Ingest against a real Postgres (TEST_DATABASE_URL); skipped without it.
 */
import { associations, commutes, incidents, networkEvents, serviceCalls, services, user, type DbHandle } from '@mct/db';
import { freshTestDb } from '@mct/db/testing';
import { fromLondon, type DarwinEvent } from '@mct/shared';
import { asc, eq } from '@mct/db/orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MockIncidentsFeed } from '../src/feeds/incidents/mock.ts';
import { ScenarioLibrary } from '../src/feeds/mock/library.ts';
import { syncIncidents } from '../src/ingest/incidents.ts';
import { purge } from '../src/ingest/purge.ts';
import { IngestPipeline } from '../src/pipeline.ts';
import type { ServiceChange } from '../src/ingest/darwin.ts';

const url = process.env.TEST_DATABASE_URL;
const DAY = '2026-11-10';
const at = (time: string, date = DAY) => fromLondon(date, time);

let h: DbHandle;
let lib: ScenarioLibrary;

async function resetLive() {
  await h.sql`truncate services, service_calls, associations, network_events, incidents, commutes cascade`;
}

async function addCommute(home = 'NCL', work = 'YRK') {
  await h.db.insert(commutes).values({
    userId: 'u1',
    name: `${home}-${work}`,
    homeCrs: home,
    workCrs: work,
    outboundStart: '07:00',
    outboundEnd: '09:30',
    returnStart: '17:00',
    returnEnd: '19:00',
    activeDays: 0b0011111,
  });
}

/** Replays the day's scenario events up to `until` through a pipeline. */
async function replay(until: Date, pipeline = new IngestPipeline(h.db, () => until)) {
  const changes: ServiceChange[] = [];
  for (const e of lib.darwinEvents([DAY]).filter((e) => e.at <= until.toISOString())) {
    changes.push(...(await pipeline.handle({ source: 'darwin', event: e })));
  }
  return { pipeline, changes };
}

async function callAt(feedId: string, tiploc: string) {
  const [row] = await h.db
    .select({ call: serviceCalls })
    .from(serviceCalls)
    .innerJoin(services, eq(services.id, serviceCalls.serviceId))
    .where(eq(services.feedId, feedId))
    .orderBy(asc(serviceCalls.seq));
  if (!row) throw new Error(`no calls for ${feedId}`);
  const calls = await h.db.select().from(serviceCalls).where(eq(serviceCalls.serviceId, row.call.serviceId));
  const c = calls.find((x) => x.tiploc === tiploc);
  if (!c) throw new Error(`${tiploc} not in ${feedId}`);
  return c;
}

const fid = (uid: string) => `mock:${DAY}:${uid}`;

describe.skipIf(!url)('ingest', () => {
  beforeAll(async () => {
    h = await freshTestDb(url!);
    lib = await ScenarioLibrary.load();
    await h.db.insert(user).values({ id: 'u1', name: 'Test', email: 'u1@example.com' });
  });
  afterAll(async () => h?.close());
  beforeEach(resetLive);

  it('persists nothing when no commute watches the stations', async () => {
    await replay(at('09:30'));
    expect(await h.db.select().from(services)).toHaveLength(0);
  });

  it('persists only services calling at watched stations', async () => {
    await addCommute();
    await replay(at('09:30'));
    const rows = await h.db.select({ feedId: services.feedId }).from(services);
    const ids = rows.map((r) => r.feedId);
    expect(ids).toContain(fid('MK1001'));
    expect(ids).not.toContain(fid('MK1003')); // Leeds–Manchester
    expect(ids).toHaveLength(lib.forDate(DAY).flatMap((c) => c.darwin).filter((e) => e.kind === 'schedule').length - 1);
  });

  it('applies platform changes, keeping the booked platform', async () => {
    await addCommute();
    await replay(at('07:30'));
    const c = await callAt(fid('MK3001'), 'NWCSTLE');
    expect(c).toMatchObject({ platform: '4', platformBooked: '2', platformConfirmed: true });
  });

  it('applies full and part cancellations', async () => {
    await addCommute();
    await replay(at('09:00'));
    const [full] = await h.db.select().from(services).where(eq(services.feedId, fid('MK4001')));
    expect(full).toMatchObject({ isCancelled: true });
    expect(full!.cancelReason).toMatch(/crew/);
    expect((await callAt(fid('MK4002'), 'YORK')).isCancelled).toBe(true);
    expect((await callAt(fid('MK4002'), 'DRLNGTN')).isCancelled).toBe(false);
  });

  it('stores forecasts, actuals and delay reasons', async () => {
    await addCommute();
    await replay(at('08:30'));
    const york = await callAt(fid('MK2001'), 'YORK');
    expect(york.fcstArr?.toISOString()).toBe('2026-11-10T08:38:00.000Z');
    const [svc] = await h.db.select().from(services).where(eq(services.feedId, fid('MK2001')));
    expect(svc!.delayReason).toMatch(/signalling/);
  });

  it('stores the forming association', async () => {
    await addCommute();
    await replay(at('07:00'));
    const rows = await h.db.select().from(associations);
    expect(rows).toEqual([expect.objectContaining({ mainFeedId: fid('MK5000'), assocFeedId: fid('MK5001'), kind: 'forms' })]);
  });

  it('reports changes once, and not for repeated identical updates', async () => {
    await addCommute();
    const { pipeline, changes } = await replay(at('07:22'));
    expect(changes.find((c) => c.feedId === fid('MK3001') && c.kinds.includes('platform'))).toBeDefined();
    const again = lib.darwinEvents([DAY]).find((e) => e.kind === 'update' && e.feedId === fid('MK3001'))!;
    expect(await pipeline.handle({ source: 'darwin', event: again })).toEqual([]);
  });

  it('keeps real-time data when a schedule is re-sent', async () => {
    await addCommute();
    const { pipeline } = await replay(at('07:30'));
    const schedule = lib.darwinEvents([DAY]).find((e) => e.kind === 'schedule' && e.service.feedId === fid('MK3001'))!;
    await pipeline.handle({ source: 'darwin', event: schedule });
    expect((await callAt(fid('MK3001'), 'NWCSTLE')).platform).toBe('4');
  });

  it('keeps an unwatched inbound working once it is known to form a watched service', async () => {
    await addCommute('YRK', 'LDS'); // watches York only
    const pipeline = new IngestPipeline(h.db, () => at('12:00'));
    const sched = (feedId: string, calls: Array<[string, string | null, string | null, string]>): DarwinEvent => ({
      kind: 'schedule',
      at: at('00:00').toISOString(),
      service: { feedId, uid: feedId, ssd: DAY, toc: 'NT', headcode: null, isPassenger: true },
      calls: calls.map(([tiploc, arr, dep, crs], i) => ({
        tiploc,
        crs,
        activity: i === 0 ? 'origin' : i === calls.length - 1 ? 'destination' : 'stop',
        schedArr: arr && at(arr).toISOString(),
        schedDep: dep && at(dep).toISOString(),
        platformBooked: null,
      })),
    });
    const inbound = sched('IN', [['NWCSTLE', null, '09:00', 'NCL'], ['DRLNGTN', '09:30', null, 'DAR']]);
    const outbound = sched('OUT', [['DRLNGTN', null, '09:50', 'DAR'], ['YORK', '10:20', null, 'YRK']]);
    const assoc: DarwinEvent = { kind: 'association', at: at('00:00').toISOString(), mainFeedId: 'IN', assocFeedId: 'OUT', association: 'forms', tiploc: 'DRLNGTN', deleted: false };

    await pipeline.handle({ source: 'darwin', event: assoc }); // neither known yet
    await pipeline.handle({ source: 'darwin', event: inbound }); // not watched: held back
    expect(await h.db.select().from(services)).toHaveLength(0);
    await pipeline.handle({ source: 'darwin', event: outbound }); // watched: both kept
    const ids = (await h.db.select({ f: services.feedId }).from(services)).map((r) => r.f).sort();
    expect(ids).toEqual(['IN', 'OUT']);
    expect(await h.db.select().from(associations)).toHaveLength(1);
  });

  it('keeps network events only on persisted routes', async () => {
    await addCommute();
    const { pipeline } = await replay(at('09:30'));
    for (const event of lib.networkEvents([DAY])) await pipeline.handle({ source: 'network', event });
    await pipeline.handle({
      source: 'network',
      event: { kind: 'movement', at: at('09:00').toISOString(), trainRef: 'X', feedId: null, tiploc: 'MNCRPIC', delayMin: 10 },
    });
    const rows = await h.db.select().from(networkEvents);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.crs?.trim() === 'DAR' || r.crs?.trim() === 'DHM')).toBe(true);
  });

  it('syncs incidents and closes those that drop off the feed', async () => {
    const feed = new MockIncidentsFeed(lib);
    expect(await syncIncidents(h.db, feed, at('09:00'))).toBe(1);
    const [open] = await h.db.select().from(incidents);
    expect(open!.affectedCrs).toEqual(['DAR']);
    expect(await syncIncidents(h.db, feed, at('10:45'))).toBe(0);
    const [closed] = await h.db.select().from(incidents);
    expect(closed!.endsAt!.getTime()).toBeLessThanOrEqual(at('10:45').getTime());
  });

  it('purges old services, orphaned associations and stale network events', async () => {
    await addCommute();
    const { pipeline } = await replay(at('09:30'));
    for (const event of lib.networkEvents([DAY])) await pipeline.handle({ source: 'network', event });
    const sameDay = await purge(h.db, at('12:00'));
    expect(sameDay).toMatchObject({ services: 0, networkEvents: 0 });
    const later = await purge(h.db, at('12:00', '2026-11-13'));
    expect(later.services).toBeGreaterThan(0);
    expect(later.associations).toBe(1);
    expect(later.networkEvents).toBe(3);
    expect(await h.db.select().from(services)).toHaveLength(0);
  });
});
