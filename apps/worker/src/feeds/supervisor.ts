import type { FeedConnection, FeedHealth } from '@mct/shared';
import type { Logger } from '../lib/logger.ts';
import { sleep } from './mock/replayer.ts';

export interface SupervisorOptions {
  minDelayMs?: number;
  maxDelayMs?: number;
  /** Called after each (re)connection attempt starts, e.g. to resync state missed during a gap. */
  onConnect?: (attempt: number) => Promise<void>;
  random?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * Keeps a feed running: if `start` throws or returns while not aborted, it is
 * restarted after an exponential backoff with full jitter. The backoff resets
 * once a connection has stayed up for a minute.
 */
export class FeedSupervisor {
  private restarts = 0;
  private lastError: string | null = null;
  private running = false;

  constructor(
    private readonly feed: FeedConnection,
    private readonly log: Logger,
    private readonly opts: SupervisorOptions = {},
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    const min = this.opts.minDelayMs ?? 1_000;
    const max = this.opts.maxDelayMs ?? 60_000;
    const random = this.opts.random ?? Math.random;
    let failures = 0;
    this.running = true;
    try {
      for (let attempt = 0; !signal.aborted; attempt++) {
        const startedAt = Date.now();
        try {
          const started = this.feed.start(signal);
          if (this.opts.onConnect) {
            await this.opts.onConnect(attempt).catch((err: unknown) => {
              this.log.error({ err, feed: this.feed.name }, 'resync after connect failed');
            });
          }
          await started;
          if (signal.aborted) break;
          throw new Error('feed stopped unexpectedly');
        } catch (err) {
          if (signal.aborted) break;
          this.lastError = err instanceof Error ? err.message : String(err);
          if (Date.now() - startedAt > 60_000) failures = 0;
          failures++;
          this.restarts++;
          const ceiling = Math.min(max, min * 2 ** (failures - 1));
          const delay = Math.round(random() * ceiling);
          this.log.warn({ feed: this.feed.name, err: this.lastError, delayMs: delay, restarts: this.restarts }, 'feed disconnected; reconnecting');
          await (this.opts.sleep ?? sleep)(delay, signal);
        }
      }
    } finally {
      this.running = false;
    }
  }

  health(): FeedHealth {
    const h = this.feed.health();
    return {
      ...h,
      connected: this.running && h.connected,
      reconnects: h.reconnects + this.restarts,
      lastError: h.lastError ?? this.lastError,
    };
  }
}
