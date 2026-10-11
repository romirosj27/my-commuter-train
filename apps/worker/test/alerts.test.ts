/**
 * Alert engine against Postgres (TEST_DATABASE_URL): replays a morning of
 * mock scenarios, evaluating each changed service as the feed would.
 */
import { alertLog, alertSettings, commutes, user, type DbHandle } from '@mct/db';
import { eq } from '@mct/db/orm';
import { freshTestDb } from '@mct/db/testing';
import { ConsoleTransport } from '@mct/email';
import { fromLondon, weekdayMask, type AlertType } from '@mct/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AlertEngine } from '../src/alerts/engine.ts';
import { sendAlertEmail } from '../src/alerts/sender.ts';
import { servicesDepartingSoon } from '../src/alerts/sweep.ts';
import { ScenarioLibrary } from '../src/feeds/mock/library.ts';
import { IngestPipeline } from '../src/pipeline.ts';

const url = process.env.TEST_DATABASE_URL;
const DAY = '2026-11-10'; // Tuesday
const at = (t: string) => fromLondon(DAY, t);

let h: DbHandle;
let lib: ScenarioLibrary;
let transport: ConsoleTransport;
let clock: Date;
let engine: AlertEngine;

interface CommuteOpts {
  outbound?: [string, string];
  days?: Array<1 | 2 | 3 | 4 | 5 | 6 | 7>;
  operators?: string[];
  types?: AlertType[];
  threshold?: number;
  quiet?: [string, string] | null;
  verified?: boolean;
}

async function setup(o: CommuteOpts = {}) {
  await h.sql`truncate "user", services, service_calls, associations, alert_log cascade`;
  transport.clear();
  await h.db.insert(user).values({ id: 'u1', name: 'Pat', email: 'pat@example.com', emailVerified: o.verified ?? true });
  const [c] = await h.db
    .insert(commutes)
    .values({
      userId: 'u1', name: 'Office', homeCrs: 'NCL', workCrs: 'YRK',
      outboundStart: o.outbound?.[0] ?? '07:00', outboundEnd: o.outbound?.[1] ?? '09:30',
      returnStart: '17:00', returnEnd: '19:00',
      activeDays: weekdayMask(o.days ?? [1, 2, 3, 4, 5]), operatorCodes: o.operators ?? [], isDefault: true,
    })
    .returning();
  await h.db.insert(alertSettings).values({
    commuteId: c!.id,
    unsubscribeToken: 'tok-0123456789abcdef',
    types: o.types ?? ['platform_change', 'cancellation', 'delay', 'predicted_disruption'],
    delayThresholdMin: o.threshold ?? 5,
    quietStart: o.quiet?.[0] ?? null,
    quietEnd: o.quiet?.[1] ?? null,
  });
  return c!;
}

/** Replays the day's Darwin events up to `until`, evaluating changed services at each event's time. */
async function replay(until: string) {
  const pipeline = new IngestPipeline(h.db, () => clock, async (changes) => {
    for (const c of changes) await engine.evaluate(c.serviceId);
  });
  const cutoff = at(until).toISOString();
  for (const e of lib.darwinEvents([DAY]).filter((e) => e.at <= cutoff)) {
    clock = new Date(e.at);
    await pipeline.handle({ source: 'darwin', event: e });
  }
  clock = at(until);
}

const subjects = () => transport.sent.map((m) => m.subject);

describe.skipIf(!url)('alert engine', () => {
  beforeAll(async () => {
    h = await freshTestDb(url!);
    lib = await ScenarioLibrary.load();
    transport = new ConsoleTransport('alerts@example.com', () => {});
    engine = new AlertEngine({
      db: h.db,
      now: () => clock,
      webURL: 'https://app.example',
      apiURL: 'https://api.example',
      enqueueEmail: async (job) => void (await sendAlertEmail(h.db, transport, job)),
    });
  });
  afterAll(async () => h?.close());
  beforeEach(() => transport.clear());

  it('sends one email per change for trains in the commute window', async () => {
    await setup();
    await replay('09:30');
    expect(subjects()).toEqual([
      'Cancelled: 08:02 Newcastle to York',
      'Now platform 4: 07:40 Newcastle to York',
      '14 min late: 08:10 Newcastle to York',
      "Won't reach York: 08:30 Newcastle to York",
    ]);
    const cancel = transport.sent[0]!;
    expect(cancel.to).toBe('pat@example.com');
    expect(cancel.text).toContain('shortage of train crew');
    expect(cancel.text).toMatch(/Live details: https:\/\/app\.example\/services\/[\w-]+\?from=NCL&to=YRK/);
    expect(cancel.text).toContain('Unsubscribe from alerts for this commute: https://api.example/api/unsubscribe?token=tok-0123456789abcdef');
    expect(cancel.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const late = transport.sent[2]!;
    expect(late.text).toContain('Expected to leave Newcastle at 08:24, arriving York at 09:24.');
    expect(late.text).toContain('late arrival of the train that forms this service');
    const rows = await h.db.select().from(alertLog);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.emailMessageId)).toBe(true);
  });

  it('does not repeat itself when the same state is evaluated again', async () => {
    await setup();
    await replay('09:30');
    transport.clear();
    clock = at('08:00');
    for (const id of await servicesDepartingSoon(h.db, clock)) await engine.evaluate(id);
    expect(subjects()).toEqual([]);
  });

  it('holds alerts during quiet hours and sends what still matters afterwards', async () => {
    await setup({ quiet: ['06:00', '08:00'] });
    await replay('08:00');
    expect(subjects()).toEqual([]);
    clock = at('08:01');
    for (const id of await servicesDepartingSoon(h.db, clock)) await engine.evaluate(id);
    // The 07:40's platform change no longer matters (it has left); the 08:02 cancellation does.
    expect(subjects()).toEqual(['Cancelled: 08:02 Newcastle to York']);
  });

  it('respects the window, operators, enabled types, days and verification', async () => {
    await setup({ outbound: ['07:00', '07:30'] });
    await replay('09:30');
    expect(subjects()).toEqual([]);

    await setup({ operators: ['XC'] });
    await replay('09:30');
    expect(subjects()).toEqual(['Now platform 4: 07:40 Newcastle to York']);

    await setup({ types: ['delay'] });
    await replay('09:30');
    expect(subjects()).toEqual(['14 min late: 08:10 Newcastle to York']);

    await setup({ threshold: 15 });
    await replay('09:30');
    expect(subjects()).not.toContain('14 min late: 08:10 Newcastle to York');

    await setup({ days: [6, 7] });
    await replay('09:30');
    expect(subjects()).toEqual([]);

    await setup({ verified: false });
    await replay('09:30');
    expect(subjects()).toEqual([]);
  });

  it('stops after the user turns alerts off', async () => {
    const c = await setup();
    await h.db.update(alertSettings).set({ enabled: false }).where(eq(alertSettings.commuteId, c.id));
    await replay('09:30');
    expect(subjects()).toEqual([]);
  });
});
