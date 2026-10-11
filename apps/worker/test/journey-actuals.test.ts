/**
 * Filling in arrival times for logged journeys (TEST_DATABASE_URL).
 */
import { commutes, journeys, services, user, type DbHandle } from '@mct/db';
import { eq } from '@mct/db/orm';
import { freshTestDb } from '@mct/db/testing';
import { fromLondon } from '@mct/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockHspClient } from '../src/feeds/hsp/mock.ts';
import { ScenarioLibrary } from '../src/feeds/mock/library.ts';
import { fillJourneyActuals } from '../src/ingest/journey-actuals.ts';
import { IngestPipeline } from '../src/pipeline.ts';

const url = process.env.TEST_DATABASE_URL;
const DAY = '2026-11-10';
const WEEK_AGO = '2026-11-03';

let h: DbHandle;
let lib: ScenarioLibrary;

describe.skipIf(!url)('journey actuals', () => {
  beforeAll(async () => {
    h = await freshTestDb(url!);
    lib = await ScenarioLibrary.load();
    await h.db.insert(user).values({ id: 'u1', name: 'Pat', email: 'p@example.com', emailVerified: true });
    await h.db.insert(commutes).values({
      userId: 'u1', name: 'Office', homeCrs: 'NCL', workCrs: 'YRK',
      outboundStart: '07:00', outboundEnd: '09:30', returnStart: '17:00', returnEnd: '19:00', activeDays: 31,
    });
    const pipeline = new IngestPipeline(h.db, () => fromLondon(DAY, '12:00'));
    for (const event of lib.darwinEvents([DAY]).filter((e) => e.at <= fromLondon(DAY, '12:00').toISOString())) {
      await pipeline.handle({ source: 'darwin', event });
    }
  });
  afterAll(async () => h?.close());

  it('fills arrival times from live data, then from HSP, and leaves unknowns alone', async () => {
    const [pd] = await h.db.select().from(services).where(eq(services.feedId, `mock:${DAY}:MK2001`));
    const base = { userId: 'u1', originCrs: 'NCL', destCrs: 'YRK', status: 'confirmed' as const, ticketType: 'single' as const };
    // Logged before the train arrived, linked to the live service.
    const [live] = await h.db
      .insert(journeys)
      .values({ ...base, serviceId: pd!.id, travelDate: DAY, toc: 'GR', schedDep: fromLondon(DAY, '07:25'), schedArr: fromLondon(DAY, '08:24'), source: 'live' })
      .returning();
    // A week ago: the live data is long gone, so HSP is used.
    const [old] = await h.db
      .insert(journeys)
      .values({ ...base, travelDate: WEEK_AGO, toc: 'TP', schedDep: fromLondon(WEEK_AGO, '08:10'), schedArr: fromLondon(WEEK_AGO, '09:10'), source: 'manual' })
      .returning();
    // A train that doesn't exist anywhere.
    const [unknown] = await h.db
      .insert(journeys)
      .values({ ...base, travelDate: WEEK_AGO, toc: 'TP', schedDep: fromLondon(WEEK_AGO, '06:01'), schedArr: fromLondon(WEEK_AGO, '07:01'), source: 'manual' })
      .returning();

    const r = await fillJourneyActuals(h.db, new MockHspClient(lib), fromLondon(DAY, '12:00'));
    expect(r).toEqual({ checked: 3, fromLive: 1, fromHsp: 1 });
    const get = async (id: string) => (await h.db.select().from(journeys).where(eq(journeys.id, id)))[0]!;
    expect(await get(live!.id)).toMatchObject({ arrivalDelayMin: 14 });
    expect(await get(old!.id)).toMatchObject({ arrivalDelayMin: 13 });
    expect((await get(unknown!.id)).actualArr).toBeNull();

    // Nothing left to do for the ones that are filled.
    expect((await fillJourneyActuals(h.db, new MockHspClient(lib), fromLondon(DAY, '12:00'))).checked).toBe(1);
  });
});
