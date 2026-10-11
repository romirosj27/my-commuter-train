/**
 * Schema constraint tests against a real Postgres (TEST_DATABASE_URL).
 * Skipped when TEST_DATABASE_URL is not set.
 */
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../src/index.ts';
import { runMigrations } from '../src/migrate.ts';
import { alertSettings, commutes, journeys, user, watchedCrs } from '../src/schema.ts';
import { seed } from '../src/seed.ts';

const url = process.env.TEST_DATABASE_URL;
let h: DbHandle;

const commute = (userId: string, over: Partial<typeof commutes.$inferInsert> = {}) => ({
  userId,
  name: 'Work',
  homeCrs: 'NCL',
  workCrs: 'YRK',
  outboundStart: '07:00',
  outboundEnd: '09:00',
  returnStart: '17:00',
  returnEnd: '19:00',
  activeDays: 0b0011111,
  ...over,
});

describe.skipIf(!url)('database schema', () => {
  beforeAll(async () => {
    h = createDb(url, { max: 2 });
    await h.sql`drop schema if exists public cascade`;
    await h.sql`drop schema if exists drizzle cascade`;
    await h.sql`create schema public`;
    await runMigrations(url);
    await seed(h.db);
    await h.db.insert(user).values([
      { id: 'u1', name: 'A', email: 'a@example.com' },
      { id: 'u2', name: 'B', email: 'b@example.com' },
    ]);
  });

  afterAll(async () => {
    await h?.close();
  });

  it('allows only one default commute per user', async () => {
    await h.db.insert(commutes).values(commute('u1', { isDefault: true }));
    await h.db.insert(commutes).values(commute('u1', { name: 'Second', isDefault: false }));
    await expect(h.db.insert(commutes).values(commute('u1', { name: 'Third', isDefault: true }))).rejects.toThrow();
    await h.db.insert(commutes).values(commute('u2', { isDefault: true })); // other users unaffected
  });

  it('rejects identical home and work stations and bad day masks', async () => {
    await expect(h.db.insert(commutes).values(commute('u1', { workCrs: 'NCL' }))).rejects.toThrow();
    await expect(h.db.insert(commutes).values(commute('u1', { activeDays: 0 }))).rejects.toThrow();
  });

  it('requires quiet hours to have both ends or neither', async () => {
    const [c] = await h.db.select().from(commutes).where(eq(commutes.userId, 'u2'));
    await expect(
      h.db.insert(alertSettings).values({ commuteId: c!.id, unsubscribeToken: 't1', quietStart: '22:00' }),
    ).rejects.toThrow();
    await h.db.insert(alertSettings).values({ commuteId: c!.id, unsubscribeToken: 't1', quietStart: '22:00', quietEnd: '06:30' });
  });

  it('exposes watched stations as a view', async () => {
    await h.db.insert(commutes).values(commute('u2', { name: 'Leeds', homeCrs: 'DAR', workCrs: 'LDS' }));
    const rows = await h.db.select().from(watchedCrs);
    expect(rows.map((r) => r.crs.trim()).sort()).toEqual(['DAR', 'LDS', 'NCL', 'YRK']);
  });

  it('deleting a user removes all their personal data', async () => {
    await h.db.insert(journeys).values({
      userId: 'u1', travelDate: '2026-11-10', originCrs: 'NCL', destCrs: 'YRK', toc: 'TP',
      schedDep: new Date('2026-11-10T07:05:00Z'), schedArr: new Date('2026-11-10T08:08:00Z'), source: 'manual',
    });
    await h.db.delete(user).where(eq(user.id, 'u1'));
    const [{ n }] = (await h.db.execute<{ n: number }>(
      sql`select (select count(*) from commutes where user_id = 'u1') + (select count(*) from journeys where user_id = 'u1') as n`,
    )) as unknown as [{ n: number }];
    expect(Number(n)).toBe(0);
  });

  it('seeds placeholder Delay Repay schemes as unverified', async () => {
    const rows = await h.sql`select toc, verified_on from delay_repay_schemes`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.verified_on === null)).toBe(true);
  });
});
