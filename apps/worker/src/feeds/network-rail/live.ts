/** Live Network Rail adapter. FEED-SCHEMA-PLACEHOLDER: transport, topics and auth not yet confirmed. */
import type { FeedHealth, NetworkEvent, NetworkRailFeed } from '@mct/shared';

export class LiveNetworkRailFeed implements NetworkRailFeed {
  readonly name = 'network-rail';
  onEvent(_handler: (e: NetworkEvent) => Promise<void>): void {}
  async start(_signal: AbortSignal): Promise<void> {
    throw new Error('Live Network Rail feed not implemented: set NETWORK_RAIL_MODE=mock until the feed docs are supplied');
  }
  health(): FeedHealth {
    return { name: this.name, mode: 'live', connected: false, lastMessageAt: null, reconnects: 0, lastError: 'not implemented' };
  }
}
