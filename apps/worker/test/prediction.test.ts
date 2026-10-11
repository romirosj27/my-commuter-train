/**
 * Prediction inputs gathered from Postgres (TEST_DATABASE_URL) for replayed scenarios.
 */
import { commutes, PredictionInputs, services, user, type DbHandle } from '@mct/db';
import { eq } from '@mct/db/orm';
import { freshTestDb } from '@mct/db/testing';
import { fromLondon } from '@mct/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockIncidentsFeed } from '../src/feeds/incidents/mock.ts';
import { ScenarioLibrary } from '../src/feeds/mock/library.ts';
import { syncIncidents } from '../src/ingest/incidents.ts';
import { IngestPipeline } from '../src/pipeline.ts';

const url = process.env.TEST_DATABASE_URL;
const DAY = '2026-11-10';
const at = (t: string) => fromLondon(DAY, t);

let h: DbHandle;
let lib: ScenarioLibrary;
let inputs: PredictionInputs;

async function replay(until: string) {
  await h.sql`truncate services, service_calls, associations, network_events, incidents cascade`;
  const now = at(until);
  const pipeline = new IngestPipeline(h.db, () => now);
  const cutoff = now.toISOString();
  for (const event of lib.darwinEvents([DAY]).filter((e) => e.at <= cutoff)) await pipeline.handle({ source: 'darwin', event });
  for (const event of lib.networkEvents([DAY]).filter((e) => e.at <= cutoff)) await pipeline.handle({ source: 'network', event });
  await syncIncidents(h.db, new MockIncidentsFeed(lib), now);
  return now;
}

async function idOf(uid: string) {
  const [s] = await h.db.select({ id: services.id }).from(services).where(eq(services.feedId, `mock:${DAY}:${uid}`));
  return s!.id;
}

describe.skipIf(!url)('prediction inputs', () => {
  beforeAll(async () => {
    h = await freshTestDb(url!);
    lib = await ScenarioLibrary.load();
    inputs = new PredictionInputs(h.db);
    await h.db.insert(user).values({ id: 'u1', name: 'Pat', email: 'p@example.com' });
    await h.db.insert(commutes).values({
      userId: 'u1', name: 'Office', homeCrs: 'NCL', workCrs: 'YRK',
      outboundStart: '07:00', outboundEnd: '09:30', returnStart: '17:00', returnEnd: '19:00', activeDays: 31,
    });
  });
  afterAll(async () => h?.close());

  it('is low risk for a train with nothing going on', async () => {
    const now = await replay('06:30');
    const r = await inputs.assess({ serviceId: await idOf('MK1001'), fromCrs: 'NCL', toCrs: 'YRK' }, now);
    expect(r).toMatchObject({ risk: 'low' });
    expect(r!.factors.map((f) => f.rule).sort()).toEqual(['forming', 'incident', 'upstream']);
  });

  it('predicts the knock-on from a late forming train before the feed does', async () => {
    const now = await replay('07:50');
    const r = await inputs.assess({ serviceId: await idOf('MK5001'), fromCrs: 'NCL', toCrs: 'YRK' }, now);
    expect(r!.risk).toBe('high');
    expect(r!.reasons[0]).toBe(
      'The train forming this service is due into Newcastle at 08:17, 25 min late. Allowing 5 min to turn round, it could leave about 12 min late.',
    );
  });

  it('flags a delayed train ahead and a published incident on the route', async () => {
    const now = await replay('09:06');
    const r = await inputs.assess({ serviceId: await idOf('MK6002'), fromCrs: 'NCL', toCrs: 'YRK' }, now);
    expect(r!.risk).toBe('medium');
    const byRule = Object.fromEntries(r!.factors.map((f) => [f.rule, f]));
    expect(byRule.upstream).toMatchObject({ risk: 'medium', reason: 'The 08:45 to York ahead of yours is 27 min late.' });
    expect(byRule.incident).toMatchObject({ risk: 'medium', reason: 'Mock: signalling problems at Darlington' });
  });

  it('rates an incident at your own station as high', async () => {
    const now = await replay('09:06');
    // Boarding at Darlington, where the incident is.
    const r = await inputs.assess({ serviceId: await idOf('MK6002'), fromCrs: 'DAR', toCrs: 'YRK' }, now);
    expect(r!.factors.find((f) => f.rule === 'incident')!.risk).toBe('high');
  });

  it('flags a cancellation just ahead', async () => {
    const now = await replay('07:50');
    // The 08:02 is cancelled, 8 minutes ahead of the 08:10.
    const r = await inputs.assess({ serviceId: await idOf('MK5001'), fromCrs: 'NCL', toCrs: 'YRK' }, now);
    expect(r!.factors.find((f) => f.rule === 'upstream')).toMatchObject({ risk: 'high', reason: 'The 08:02 to York just ahead of yours is cancelled.' });
  });
});
