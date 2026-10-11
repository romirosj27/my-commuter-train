/**
 * API integration: mock scenarios are replayed through the real ingest
 * pipeline into Postgres (TEST_DATABASE_URL), then queried over HTTP.
 */
import { commutes, user, type DbHandle } from '@mct/db';
import { freshTestDb } from '@mct/db/testing';
import { fromLondon, type BoardService, type ServiceDetail } from '@mct/shared';
import { IngestPipeline } from '@mct/worker/ingest';
import { ScenarioLibrary } from '@mct/worker/mock';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';

const url = process.env.TEST_DATABASE_URL;
const DAY = '2026-11-10';
const NEXT = '2026-11-11';
const NOW = fromLondon(NEXT, '01:00');

let h: DbHandle;
let app: FastifyInstance;

const get = async <T>(path: string) => {
  const res = await app.inject({ method: 'GET', url: path });
  return { status: res.statusCode, body: res.json() as T };
};
type Board = { services: BoardService[] };
const hm = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(11, 16) : null); // UTC == London in November

describe.skipIf(!url)('board API', () => {
  beforeAll(async () => {
    h = await freshTestDb(url!);
    await h.db.insert(user).values({ id: 'u1', name: 'Test', email: 'u1@example.com' });
    await h.db.insert(commutes).values({
      userId: 'u1', name: 'Work', homeCrs: 'NCL', workCrs: 'YRK',
      outboundStart: '07:00', outboundEnd: '09:00', returnStart: '17:00', returnEnd: '19:00', activeDays: 31,
    });
    const lib = await ScenarioLibrary.load();
    // Replay the whole day (and the late-night service into the next), as of 08:40 for the morning events.
    const pipeline = new IngestPipeline(h.db, () => NOW);
    const cutoff = fromLondon(DAY, '08:40').toISOString();
    for (const e of lib.darwinEvents([DAY]).filter((e) => e.at <= cutoff || e.at.startsWith(NEXT) || e.at >= fromLondon(DAY, '17:00').toISOString())) {
      await pipeline.handle({ source: 'darwin', event: e });
    }
    app = await buildApp({ db: h, now: () => fromLondon(DAY, '08:40') });
  });

  afterAll(async () => {
    await app?.close();
    await h?.close();
  });

  it('reports health', async () => {
    expect(await get('/health')).toEqual({ status: 200, body: { status: 'ok', checks: { database: 'ok' } } });
  });

  it('searches stations by CRS and name', async () => {
    const byCode = await get<{ stations: Array<{ crs: string }> }>('/api/stations?q=yrk');
    expect(byCode.body.stations[0]).toEqual({ crs: 'YRK', name: 'York' });
    const byName = await get<{ stations: Array<{ crs: string }> }>('/api/stations?q=dur');
    expect(byName.body.stations.map((s) => s.crs)).toEqual(['DHM']);
    const inner = await get<{ stations: Array<{ crs: string }> }>('/api/stations?q=street');
    expect(inner.body.stations.map((s) => s.crs)).toEqual(['CLS']);
    const fuzzy = await get<{ stations: Array<{ crs: string }> }>('/api/stations?q=newcastel');
    expect(fuzzy.body.stations[0]?.crs).toBe('NCL');
    expect((await get('/api/stations?q=')).status).toBe(400);
  });

  it('lists operators', async () => {
    const { body } = await get<{ operators: Array<{ code: string }> }>('/api/operators');
    expect(body.operators.map((o) => o.code)).toContain('TP');
  });

  it('builds the outbound board with live status', async () => {
    const { status, body } = await get<Board>(`/api/board?from=NCL&to=YRK&date=${DAY}&start=07:00&end=08:45`);
    expect(status).toBe(200);
    const rows = body.services.map((s) => [hm(s.from.departure.scheduled), s.toc, s.status, s.delayMin]);
    expect(rows).toEqual([
      ['07:05', 'TP', 'on_time', -1], // arrived a minute early
      ['07:25', 'GR', 'delayed', 14],
      ['07:40', 'XC', 'on_time', 0],
      ['08:02', 'TP', 'cancelled', null],
      ['08:10', 'TP', 'delayed', 14],
      ['08:30', 'GR', 'part_cancelled', 0],
    ]);
    const xc = body.services[2]!;
    expect(xc.from).toMatchObject({ platform: '4', platformBooked: '2', platformChanged: true });
    expect(xc).toMatchObject({ operator: 'CrossCountry', origin: 'Newcastle', destination: 'York', progress: 'arrived' });
    expect(body.services[3]!.reason).toMatch(/crew/);
    expect(body.services[4]!.reason).toMatch(/forms this service/);
    expect(body.services[5]!.reason).toMatch(/fault on this train/);
  });

  it('filters by operator', async () => {
    const { body } = await get<Board>(`/api/board?from=NCL&to=YRK&date=${DAY}&start=07:00&end=09:00&operators=GR`);
    expect(body.services.every((s) => s.toc === 'GR')).toBe(true);
    expect(body.services.map((s) => hm(s.from.departure.scheduled))).toEqual(['07:25', '08:30', '08:45']);
  });

  it('builds the return board and a window that wraps midnight', async () => {
    const ret = await get<Board>(`/api/board?from=YRK&to=NCL&date=${DAY}&start=17:00&end=19:00`);
    expect(ret.body.services.map((s) => hm(s.from.departure.scheduled))).toEqual(['17:20', '17:45']);
    const night = await get<Board>(`/api/board?from=NCL&to=YRK&date=${DAY}&start=23:00&end=01:00`);
    expect(night.body.services).toHaveLength(1);
    expect(night.body.services[0]).toMatchObject({ status: 'delayed', delayMin: 5, progress: 'arrived' });
    expect(night.body.services[0]!.to.arrival.scheduled).toBe('2026-11-11T00:38:00.000Z');
  });

  it('validates board input', async () => {
    expect((await get('/api/board?from=NCL&to=NCL')).status).toBe(400);
    expect((await get('/api/board?from=NCL&to=YRK&start=7am')).status).toBe(400);
    expect((await get('/api/board?from=NC&to=YRK')).status).toBe(400);
  });

  it('returns service detail with the calling pattern and forming service', async () => {
    const { body } = await get<Board>(`/api/board?from=NCL&to=YRK&date=${DAY}&start=08:10&end=08:11`);
    const id = body.services[0]!.serviceId;
    const detail = await get<ServiceDetail>(`/api/services/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.calls.map((c) => c.crs)).toEqual(['NCL', 'DHM', 'DAR', 'NTR', 'YRK']);
    expect(detail.body.formedBy).toMatchObject({ origin: 'York', destination: 'Newcastle' });
    expect(detail.body.formedBy!.at).toMatchObject({ crs: 'NCL' });
    expect(detail.body.formedBy!.at!.arrival).toMatchObject({ isActual: true, delayMin: 26 });
    expect(hm(detail.body.formedBy!.at!.arrival.expected)).toBe('08:18');
    expect(detail.body.forms).toBeNull();
  });

  it('404s an unknown service and 400s a bad id', async () => {
    expect((await get('/api/services/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await get('/api/services/nope')).status).toBe(400);
  });

  it('rate-limits', async () => {
    const limited = await buildApp({ db: h, rateLimitPerMin: 2 });
    try {
      const codes = [];
      for (let i = 0; i < 3; i++) codes.push((await limited.inject({ method: 'GET', url: '/api/operators' })).statusCode);
      expect(codes).toEqual([200, 200, 429]);
    } finally {
      await limited.close();
    }
  });
});
