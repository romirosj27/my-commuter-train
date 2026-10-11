/**
 * Live Darwin adapter.
 *
 * FEED-SCHEMA-PLACEHOLDER: the transport (and its auth flow) for the Rail
 * Data Marketplace Darwin product has not been confirmed. This class exists so
 * the wiring compiles; it refuses to start until implemented.
 */
import type { DarwinEvent, DarwinFeed, FeedHealth } from '@mct/shared';

export class LiveDarwinFeed implements DarwinFeed {
  readonly name = 'darwin';
  onEvent(_handler: (e: DarwinEvent) => Promise<void>): void {}
  async start(_signal: AbortSignal): Promise<void> {
    throw new Error('Live Darwin feed not implemented: set DARWIN_MODE=mock until the feed docs are supplied');
  }
  // eslint-disable-next-line require-yield
  async *snapshot(): AsyncIterable<DarwinEvent> {
    throw new Error('Live Darwin snapshot not implemented');
  }
  health(): FeedHealth {
    return { name: this.name, mode: 'live', connected: false, lastMessageAt: null, reconnects: 0, lastError: 'not implemented' };
  }
}
