import type { FeedHealth, NetworkEvent, NetworkRailFeed } from '@mct/shared';
import type { Clock } from '../../lib/clock.ts';
import type { ScenarioLibrary } from '../mock/library.ts';
import { Replayer, type ReplayOptions } from '../mock/replayer.ts';

export class MockNetworkRailFeed implements NetworkRailFeed {
  readonly name = 'network-rail';
  private replayer: Replayer<NetworkEvent>;

  constructor(library: ScenarioLibrary, clock: Clock, opts?: ReplayOptions) {
    this.replayer = new Replayer(
      'network-rail',
      clock,
      (now) => library.networkEvents(library.datesAround(now)),
      (e) => JSON.stringify(e),
      opts,
    );
  }

  onEvent(handler: (e: NetworkEvent) => Promise<void>): void {
    this.replayer.onEvent(handler);
  }
  start(signal: AbortSignal): Promise<void> {
    return this.replayer.start(signal);
  }
  tick(): Promise<number> {
    return this.replayer.tick();
  }
  health(): FeedHealth {
    return this.replayer.health();
  }
}
