/**
 * Main account and commute flows over HTTP, against Postgres (TEST_DATABASE_URL).
 */
import { commutes, journeys, user, type DbHandle } from '@mct/db';
import { eq } from '@mct/db/orm';
import { freshTestDb } from '@mct/db/testing';
import type { ConsoleTransport } from '@mct/email';
import { fromLondon, type CommuteDto } from '@mct/shared';
import { IngestPipeline } from '@mct/worker/ingest';
import { ScenarioLibrary } from '@mct/worker/mock';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, linkFrom, signedInUser, testApp, WEB } from './helpers.ts';

const url = process.env.TEST_DATABASE_URL;
const DAY = '2026-11-10'; // Tuesday

let h: DbHandle;
let app: FastifyInstance;
let email: ConsoleTransport;

const commuteBody = {
  name: 'Office',
  homeCrs: 'NCL',
  workCrs: 'YRK',
  outbound: { start: '07:00', end: '08:45' },
  return: { start: '17:00', end: '19:00' },
  activeDays: [1, 2, 3, 4, 5],
};

describe.skipIf(!url)('accounts and commutes', () => {
  beforeAll(async () => {
    h = await freshTestDb(url!);
    ({ app, email } = await testApp(h, { now: () => fromLondon(DAY, '08:40') }));
  });
  afterAll(async () => {
    await app?.close();
    await h?.close();
  });

  describe('auth', () => {
    it('requires email verification before signing in', async () => {
      const c = new Client(app);
      const signUp = await c.post('/api/auth/sign-up/email', { email: 'new@example.com', password: 'a-long-password', name: 'New', callbackURL: `${WEB}/` });
      expect(signUp.statusCode).toBe(200);
      expect(email.sent.at(-1)).toMatchObject({ to: 'new@example.com', subject: 'Confirm your email address' });

      const early = await c.post('/api/auth/sign-in/email', { email: 'new@example.com', password: 'a-long-password' });
      expect(early.statusCode).toBe(403);
      expect((await c.get('/api/commutes')).statusCode).toBe(401);

      const link = new URL(linkFrom(email, 'new@example.com'));
      const verify = await c.get(link.pathname + link.search);
      expect(verify.statusCode).toBe(302);
      expect(verify.headers.location).toBe(`${WEB}/`);
      expect((await c.get('/api/me')).json()).toMatchObject({ email: 'new@example.com' });

      await c.post('/api/auth/sign-out', {});
      expect((await c.get('/api/me')).statusCode).toBe(401);
      const signIn = await c.post('/api/auth/sign-in/email', { email: 'new@example.com', password: 'a-long-password' });
      expect(signIn.statusCode).toBe(200);
      expect((await c.get('/api/me')).statusCode).toBe(200);
    });

    it('rejects short passwords and wrong passwords', async () => {
      const c = new Client(app);
      expect((await c.post('/api/auth/sign-up/email', { email: 'short@example.com', password: 'short', name: 'S' })).statusCode).toBe(400);
      expect((await c.post('/api/auth/sign-in/email', { email: 'new@example.com', password: 'wrong-password' })).statusCode).toBe(401);
    });

    it('resets a password by email', async () => {
      const c = await signedInUser(app, email, 'reset@example.com', 'original-password');
      const anon = new Client(app);
      const req = await anon.post('/api/auth/request-password-reset', { email: 'reset@example.com', redirectTo: `${WEB}/reset-password` });
      expect(req.statusCode).toBe(200);
      const link = new URL(linkFrom(email, 'reset@example.com'));
      const follow = await anon.get(link.pathname + link.search);
      expect(follow.statusCode).toBe(302);
      const token = new URL(follow.headers.location as string).searchParams.get('token');
      expect(token).toBeTruthy();

      expect((await anon.post('/api/auth/reset-password', { token, newPassword: 'brand-new-password' })).statusCode).toBe(200);
      expect((await c.get('/api/me')).statusCode).toBe(401); // other sessions revoked
      expect((await anon.post('/api/auth/sign-in/email', { email: 'reset@example.com', password: 'original-password' })).statusCode).toBe(401);
      expect((await anon.post('/api/auth/sign-in/email', { email: 'reset@example.com', password: 'brand-new-password' })).statusCode).toBe(200);
    });
  });

  describe('commutes', () => {
    let c: Client;
    let first: CommuteDto;

    beforeAll(async () => {
      c = await signedInUser(app, email, 'commuter@example.com');
    });

    it('creates a commute with default alert settings, defaulting the first', async () => {
      const res = await c.post('/api/commutes', commuteBody);
      expect(res.statusCode).toBe(201);
      first = res.json();
      expect(first).toMatchObject({
        homeName: 'Newcastle',
        workName: 'York',
        isDefault: true,
        activeDays: [1, 2, 3, 4, 5],
        operatorCodes: [],
        alertSettings: { enabled: true, delayThresholdMin: 5, quietHours: null },
      });
    });

    it('validates commute input', async () => {
      expect((await c.post('/api/commutes', { ...commuteBody, workCrs: 'NCL' })).statusCode).toBe(400);
      expect((await c.post('/api/commutes', { ...commuteBody, homeCrs: 'ZZZ' })).statusCode).toBe(400);
      expect((await c.post('/api/commutes', { ...commuteBody, activeDays: [] })).statusCode).toBe(400);
      expect((await c.post('/api/commutes', { ...commuteBody, outbound: { start: '25:00', end: '09:00' } })).statusCode).toBe(400);
      expect((await c.post('/api/commutes', { ...commuteBody, extra: true })).statusCode).toBe(400);
    });

    it('keeps exactly one default commute', async () => {
      const second: CommuteDto = (await c.post('/api/commutes', { ...commuteBody, name: 'Leeds', workCrs: 'LDS', isDefault: true })).json();
      expect(second.isDefault).toBe(true);
      const list: CommuteDto[] = (await c.get('/api/commutes')).json().commutes;
      expect(list.filter((x) => x.isDefault).map((x) => x.id)).toEqual([second.id]);

      await c.post(`/api/commutes/${first.id}/default`);
      expect((await c.get(`/api/commutes/${first.id}`)).json().isDefault).toBe(true);

      expect((await c.delete(`/api/commutes/${first.id}`)).statusCode).toBe(204);
      expect((await c.get(`/api/commutes/${second.id}`)).json().isDefault).toBe(true); // promoted
      first = (await c.post('/api/commutes', commuteBody)).json();
      expect(first.isDefault).toBe(false);
    });

    it('patches a commute and re-validates the merged result', async () => {
      const res = await c.patch(`/api/commutes/${first.id}`, { operatorCodes: ['tp', 'GR', 'TP'], activeDays: [5, 1] });
      expect(res.json()).toMatchObject({ operatorCodes: ['TP', 'GR'], activeDays: [1, 5], name: 'Office' });
      expect((await c.patch(`/api/commutes/${first.id}`, { workCrs: 'NCL' })).statusCode).toBe(400);
    });

    it('updates alert settings', async () => {
      const settings = { enabled: true, types: ['cancellation', 'delay'], delayThresholdMin: 10, quietHours: { start: '22:00', end: '06:30' } };
      expect((await c.put(`/api/commutes/${first.id}/alert-settings`, settings)).json()).toEqual(settings);
      expect((await c.put(`/api/commutes/${first.id}/alert-settings`, { ...settings, types: ['nope'] })).statusCode).toBe(400);
    });

    it("hides other users' commutes", async () => {
      const other = await signedInUser(app, email, 'other@example.com');
      expect((await other.get(`/api/commutes/${first.id}`)).statusCode).toBe(404);
      expect((await other.patch(`/api/commutes/${first.id}`, { name: 'Mine' })).statusCode).toBe(404);
      expect((await other.delete(`/api/commutes/${first.id}`)).statusCode).toBe(404);
      expect((await other.get('/api/commutes')).json().commutes).toEqual([]);
    });

    it("serves the commute's board in each direction, with its operator filter", async () => {
      await c.patch(`/api/commutes/${first.id}`, { activeDays: [1, 2, 3, 4, 5] });
      const lib = await ScenarioLibrary.load();
      const pipeline = new IngestPipeline(h.db, () => fromLondon(DAY, '08:40'));
      const cutoff = fromLondon(DAY, '08:40').toISOString();
      for (const e of lib.darwinEvents([DAY])) {
        if (e.at <= cutoff || e.at >= fromLondon(DAY, '17:00').toISOString()) await pipeline.handle({ source: 'darwin', event: e });
      }
      const out = (await c.get(`/api/commutes/${first.id}/board?date=${DAY}`)).json();
      expect(out).toMatchObject({ direction: 'outbound', window: { start: '07:00', end: '08:45' }, activeDay: true });
      expect(out.services.map((s: { toc: string }) => s.toc)).toEqual(['TP', 'GR', 'TP', 'TP', 'GR']); // TP/GR only
      const ret = (await c.get(`/api/commutes/${first.id}/board?direction=return&date=${DAY}`)).json();
      expect(ret.services.map((s: { from: { crs: string } }) => s.from.crs)).toEqual(['YRK']);
      const saturday = (await c.get(`/api/commutes/${first.id}/board?date=2026-11-14`)).json();
      expect(saturday.activeDay).toBe(false);
    });
  });

  describe('GDPR', () => {
    it('exports the user’s data without secrets', async () => {
      const c = await signedInUser(app, email, 'export@example.com');
      await c.post('/api/commutes', commuteBody);
      const res = await c.get('/api/me/export');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-disposition']).toMatch(/attachment/);
      const data = res.json();
      expect(data.profile).toMatchObject({ email: 'export@example.com' });
      expect(data.commutes).toHaveLength(1);
      expect(data.alertSettings).toHaveLength(1);
      expect(JSON.stringify(data)).not.toMatch(/password|unsubscribe|token/i);
    });

    it('deletes the account and all personal data with the password', async () => {
      const c = await signedInUser(app, email, 'leaver@example.com', 'leaver-password');
      const created: CommuteDto = (await c.post('/api/commutes', commuteBody)).json();
      const [u] = await h.db.select().from(user).where(eq(user.email, 'leaver@example.com'));
      await h.db.insert(journeys).values({
        userId: u!.id, travelDate: DAY, originCrs: 'NCL', destCrs: 'YRK', toc: 'TP',
        schedDep: new Date(), schedArr: new Date(), source: 'manual',
      });

      expect((await c.post('/api/auth/delete-user', { password: 'wrong-password' })).statusCode).toBe(400);
      const del = await c.post('/api/auth/delete-user', { password: 'leaver-password' });
      expect(del.statusCode).toBe(200);
      expect(await h.db.select().from(user).where(eq(user.id, u!.id))).toHaveLength(0);
      expect(await h.db.select().from(commutes).where(eq(commutes.id, created.id))).toHaveLength(0);
      expect(await h.db.select().from(journeys).where(eq(journeys.userId, u!.id))).toHaveLength(0);
      expect((await c.get('/api/me')).statusCode).toBe(401);
    });
  });

  describe('demo seed', () => {
    it('creates demo users who can sign in, idempotently', async () => {
      const { seedDemo } = await import('../src/seed-demo.ts');
      await seedDemo(h.db);
      await seedDemo(h.db);
      const c = new Client(app);
      expect((await c.post('/api/auth/sign-in/email', { email: 'demo@example.com', password: 'demo-password-123' })).statusCode).toBe(200);
      const list: CommuteDto[] = (await c.get('/api/commutes')).json().commutes;
      expect(list.map((x) => [x.name, x.isDefault])).toEqual([['Office', true], ['Leeds site', false]]);
    });
  });
});
