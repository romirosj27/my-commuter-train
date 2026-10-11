/**
 * Delay Repay helper over HTTP, against Postgres (TEST_DATABASE_URL).
 */
import type { DbHandle } from '@mct/db';
import { freshTestDb } from '@mct/db/testing';
import type { ConsoleTransport } from '@mct/email';
import { fromLondon, type CommuteDto } from '@mct/shared';
import { IngestPipeline } from '@mct/worker/ingest';
import { ScenarioLibrary } from '@mct/worker/mock';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JourneyDto, SuggestionDto } from '../src/services/journeys.ts';
import { signedInUser, testApp, type Client } from './helpers.ts';

const url = process.env.TEST_DATABASE_URL;
const DAY = '2026-11-10'; // Tuesday
const hm = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(11, 16) : null); // GMT in November

let h: DbHandle;
let app: FastifyInstance;
let email: ConsoleTransport;
let pat: Client;
let commute: CommuteDto;

const TP_BANDS_5 = [
  { minMinutes: 5, maxMinutes: 15, singlePct: 10, returnPct: 5 },
  { minMinutes: 15, maxMinutes: null, singlePct: 50, returnPct: 25 },
];

describe.skipIf(!url)('Delay Repay helper', () => {
  beforeAll(async () => {
    h = await freshTestDb(url!);
    ({ app, email } = await testApp(h, { now: () => fromLondon(DAY, '20:00'), adminEmails: ['admin@example.com'] }));
    pat = await signedInUser(app, email, 'pat@example.com');
    commute = (
      await pat.post('/api/commutes', {
        name: 'Office', homeCrs: 'NCL', workCrs: 'YRK',
        outbound: { start: '07:00', end: '09:30' }, return: { start: '17:00', end: '19:00' }, activeDays: [1, 2, 3, 4, 5],
      })
    ).json();
    const lib = await ScenarioLibrary.load();
    const pipeline = new IngestPipeline(h.db, () => fromLondon(DAY, '20:00'));
    for (const event of lib.darwinEvents([DAY]).filter((e) => e.at <= fromLondon(DAY, '20:00').toISOString())) {
      await pipeline.handle({ source: 'darwin', event });
    }
  });
  afterAll(async () => {
    await app?.close();
    await h?.close();
  });

  it('suggests the first train in each window when there is no history', async () => {
    const res = await pat.get(`/api/journeys/suggestions?date=${DAY}`);
    const { suggestions } = res.json() as { suggestions: SuggestionDto[] };
    expect(suggestions.map((s) => [s.direction, s.basis, hm(s.schedDep)])).toEqual([
      ['outbound', 'first', '07:05'],
      ['return', 'first', '17:20'],
    ]);
    expect(suggestions[0]).toMatchObject({ originCrs: 'NCL', destCrs: 'YRK', operator: 'TransPennine Express' });
    expect(hm(suggestions[0]!.actualArr)).toBe('08:07');
  });

  it('logs a confirmed suggestion with times from the live data, once', async () => {
    const { suggestions } = (await pat.get(`/api/journeys/suggestions?date=${DAY}`)).json() as { suggestions: SuggestionDto[] };
    const s = suggestions[0]!;
    const res = await pat.post('/api/journeys', { serviceId: s.serviceId, originCrs: 'NCL', destCrs: 'YRK', commuteId: commute.id });
    expect(res.statusCode).toBe(201);
    const j: JourneyDto = res.json();
    expect(j).toMatchObject({ travelDate: DAY, arrivalDelayMin: -1, source: 'live', eligibility: { status: 'not_eligible', message: 'You arrived on time.' } });
    expect((await pat.post('/api/journeys', { serviceId: s.serviceId, originCrs: 'NCL', destCrs: 'YRK' })).statusCode).toBe(409);
    // That direction is now logged, so only the return is suggested.
    const after = (await pat.get(`/api/journeys/suggestions?date=${DAY}`)).json() as { suggestions: SuggestionDto[] };
    expect(after.suggestions.map((x) => x.direction)).toEqual(['return']);
  });

  it('suggests the usual train once there is history', async () => {
    const other = await signedInUser(app, email, 'usual@example.com');
    await other.post('/api/commutes', {
      name: 'Office', homeCrs: 'NCL', workCrs: 'YRK',
      outbound: { start: '07:00', end: '09:30' }, return: { start: '17:00', end: '19:00' }, activeDays: [1, 2, 3, 4, 5],
    });
    for (const d of ['2026-11-02', '2026-11-03']) {
      await other.post('/api/journeys', { travelDate: d, originCrs: 'NCL', destCrs: 'YRK', toc: 'TP', schedDep: '08:10', schedArr: '09:10', actualArr: '09:10' });
    }
    const { suggestions } = (await other.get(`/api/journeys/suggestions?date=${DAY}`)).json() as { suggestions: SuggestionDto[] };
    const out = suggestions.find((s) => s.direction === 'outbound')!;
    expect(out).toMatchObject({ basis: 'usual' });
    expect(hm(out.schedDep)).toBe('08:10');
    expect(hm(out.actualArr)).toBe('09:23');
  });

  it('works out delay and eligibility for a hand-entered journey across midnight', async () => {
    const res = await pat.post('/api/journeys', {
      travelDate: DAY, originCrs: 'NCL', destCrs: 'YRK', toc: 'GR', schedDep: '23:40', schedArr: '00:38', actualArr: '00:59', ticketType: 'return',
    });
    expect(res.statusCode).toBe(201);
    const j: JourneyDto = res.json();
    expect(j.schedArr).toBe('2026-11-11T00:38:00.000Z');
    expect(j).toMatchObject({
      arrivalDelayMin: 21,
      eligibility: { status: 'eligible', percent: 12.5, schemeVerified: false, message: '21 min late (15–29 min band): 12.5% of your return ticket.' },
    });
    expect((await pat.post('/api/journeys', { travelDate: DAY, originCrs: 'NCL', destCrs: 'NCL', toc: 'GR', schedDep: '08:00', schedArr: '09:00' })).statusCode).toBe(400);
    expect((await pat.post('/api/journeys', { travelDate: DAY, originCrs: 'NCL', destCrs: 'YRK', toc: 'GR', schedDep: '8am', schedArr: '09:00' })).statusCode).toBe(400);
  });

  it('asks for the arrival time when unknown, and updates it', async () => {
    const j: JourneyDto = (
      await pat.post('/api/journeys', { travelDate: '2026-11-09', originCrs: 'YRK', destCrs: 'NCL', toc: 'TP', schedDep: '17:20', schedArr: '18:22' })
    ).json();
    expect(j.eligibility.status).toBe('needs_arrival_time');
    const updated: JourneyDto = (await pat.patch(`/api/journeys/${j.id}`, { actualArr: '18:55', claimStatus: 'claimed' })).json();
    expect(updated).toMatchObject({ arrivalDelayMin: 33, claimStatus: 'claimed', eligibility: { status: 'eligible', percent: 50 } });
  });

  it("only shows and edits the user's own journeys", async () => {
    const mine: JourneyDto[] = (await pat.get('/api/journeys')).json().journeys;
    expect(mine.length).toBe(3);
    expect(mine.map((j) => j.travelDate)).toEqual([DAY, DAY, '2026-11-09']); // newest first
    const stranger = await signedInUser(app, email, 'stranger@example.com');
    expect((await stranger.get('/api/journeys')).json().journeys).toEqual([]);
    expect((await stranger.patch(`/api/journeys/${mine[0]!.id}`, { claimStatus: 'paid' })).statusCode).toBe(404);
    expect((await stranger.delete(`/api/journeys/${mine[0]!.id}`)).statusCode).toBe(404);
    expect((await pat.get('/api/journeys')).json().note).toMatch(/check the operator's current Delay Repay terms/);
  });

  it('lets only admins edit operator rules, with validation, and applies them', async () => {
    const schemes = (await pat.get('/api/delay-repay/schemes')).json().schemes as Array<{ toc: string; verifiedOn: string | null }>;
    expect(schemes.find((s) => s.toc === 'TP')).toMatchObject({ verifiedOn: null });
    const body = { name: 'TPE Delay Repay', bands: TP_BANDS_5, claimUrl: null, notes: 'Test bands', verifiedOn: '2026-11-01' };
    expect((await pat.put('/api/delay-repay/schemes/TP', body)).statusCode).toBe(403);
    expect((await pat.get('/api/me')).json().isAdmin).toBe(false);

    const admin = await signedInUser(app, email, 'admin@example.com');
    expect((await admin.get('/api/me')).json().isAdmin).toBe(true);
    expect((await admin.put('/api/delay-repay/schemes/TP', { ...body, bands: [TP_BANDS_5[1], TP_BANDS_5[0]] })).statusCode).toBe(400);
    expect((await admin.put('/api/delay-repay/schemes/TP', { ...body, claimUrl: 'http://insecure.example' })).statusCode).toBe(400);
    expect((await admin.put('/api/delay-repay/schemes/ZZ', body)).statusCode).toBe(404);
    expect((await admin.put('/api/delay-repay/schemes/TP', body)).statusCode).toBe(200);

    const tp = ((await pat.get('/api/journeys')).json().journeys as JourneyDto[]).find((j) => j.toc === 'TP' && j.travelDate === '2026-11-09')!;
    expect(tp.eligibility).toMatchObject({ status: 'eligible', percent: 50, schemeVerified: true });
  });
});
