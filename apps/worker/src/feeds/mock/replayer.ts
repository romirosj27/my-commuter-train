import type { FeedHealth, IsoInstant } from '@mct/shared';
import type { Clock } from '../../lib/clock.ts';

export interface ReplayOptions {
  /** How often to check for due events, in real milliseconds. */
  tickMs?: number;
}

/**
 * Replays timestamped events against a clock: everything already due is
 * emitted on start (catch-up), then events are emitted as the clock reaches them.
 * Events are de-duplicated by key so moving across a day boundary doesn't repeat them.
 */
export class Replayer<E extends { at: IsoInstant }> {
  private handlers: Array<(e: E) => Promise<void>> = [];
  private emitted = new Set<string>();
  private lastMessageAt: string | null = null;
  private connected = false;

  constructor(
    readonly name: string,
    private readonly clock: Clock,
    private readonly source: (now: Date) => E[],
    private readonly key: (e: E) => string,
    private readonly opts: ReplayOptions = {},
  ) {}

  onEvent(handler: (e: E) => Promise<void>): void {
    this.handlers.push(handler);
  }

  /** Emits every event due at the clock's current time that hasn't been emitted yet. */
  async tick(): Promise<number> {
    const now = this.clock.now();
    const nowIso = now.toISOString();
    let count = 0;
    for (const e of this.source(now)) {
      if (e.at > nowIso) break;
      const k = this.key(e);
      if (this.emitted.has(k)) continue;
      this.emitted.add(k);
      for (const h of this.handlers) await h(e);
      this.lastMessageAt = nowIso;
      count++;
    }
    return count;
  }

  async start(signal: AbortSignal): Promise<void> {
    this.connected = true;
    try {
      while (!signal.aborted) {
        await this.tick();
        await sleep(this.opts.tickMs ?? 1000, signal);
      }
    } finally {
      this.connected = false;
    }
  }

  health(): FeedHealth {
    return {
      name: this.name,
      mode: 'mock',
      connected: this.connected,
      lastMessageAt: this.lastMessageAt,
      reconnects: 0,
      lastError: null,
    };
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}
