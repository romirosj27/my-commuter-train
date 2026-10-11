import type { FeedConnection, FeedHealth } from '@mct/shared';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { FeedSupervisor } from '../src/feeds/supervisor.ts';
import { healthReport } from '../src/health.ts';

const log = pino({ level: 'silent' });

/** A feed that fails `failures` times, then stays connected until aborted. */
class FlakyFeed implements FeedConnection {
  readonly name = 'flaky';
  starts = 0;
  connected = false;
  constructor(private failures: number) {}
  async start(signal: AbortSignal): Promise<void> {
    this.starts++;
    if (this.failures-- > 0) throw new Error(`drop ${this.starts}`);
    this.connected = true;
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    this.connected = false;
  }
  health(): FeedHealth {
    return { name: this.name, mode: 'live', connected: this.connected, lastMessageAt: null, reconnects: 0, lastError: null };
  }
}

const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!cond()) throw new Error('timed out');
};

describe('FeedSupervisor', () => {
  it('reconnects after failures and resyncs on every connect', async () => {
    const feed = new FlakyFeed(2);
    const attempts: number[] = [];
    const sup = new FeedSupervisor(feed, log, {
      minDelayMs: 1,
      maxDelayMs: 4,
      onConnect: async (a) => void attempts.push(a),
    });
    const ac = new AbortController();
    const run = sup.run(ac.signal);
    await waitFor(() => feed.connected);
    expect(feed.starts).toBe(3);
    expect(attempts).toEqual([0, 1, 2]);
    expect(sup.health()).toMatchObject({ connected: true, reconnects: 2, lastError: 'drop 2' });
    ac.abort();
    await run;
    expect(sup.health().connected).toBe(false);
  });

  it('treats a feed that returns on its own as a disconnect', async () => {
    let starts = 0;
    const feed: FeedConnection = {
      name: 'quitter',
      start: async () => void starts++,
      health: () => ({ name: 'quitter', mode: 'live', connected: false, lastMessageAt: null, reconnects: 0, lastError: null }),
    };
    const ac = new AbortController();
    const run = new FeedSupervisor(feed, log, { minDelayMs: 1, maxDelayMs: 1 }).run(ac.signal);
    await waitFor(() => starts >= 3);
    ac.abort();
    await run;
  });

  it('backs off exponentially, capped', async () => {
    const delays: number[] = [];
    const feed = new FlakyFeed(5);
    const sup = new FeedSupervisor(feed, log, {
      minDelayMs: 10,
      maxDelayMs: 40,
      random: () => 1,
      sleep: async (ms) => void delays.push(ms),
    });
    const ac = new AbortController();
    const run = sup.run(ac.signal);
    await waitFor(() => feed.connected);
    ac.abort();
    await run;
    expect(delays.slice(0, 5)).toEqual([10, 20, 40, 40, 40]);
  });
});

describe('healthReport', () => {
  it('is degraded when a feed is down and down when a dependency fails', async () => {
    const feed = { name: 'darwin', mode: 'mock', connected: false, lastMessageAt: null, reconnects: 1, lastError: 'x' } as const;
    const ok = await healthReport({ feeds: () => [feed], checks: { database: async () => {} } });
    expect(ok.status).toBe('degraded');
    const down = await healthReport({
      feeds: () => [{ ...feed, connected: true }],
      checks: { database: async () => { throw new Error('refused'); } },
    });
    expect(down).toMatchObject({ status: 'down', checks: { database: 'refused' } });
  });
});
