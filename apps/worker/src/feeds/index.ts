import type { DarwinFeed, HspClient, IncidentsFeed, NetworkRailFeed, ReferenceDataSource } from '@mct/shared';
import { SimClock, systemClock, type Clock } from '../lib/clock.ts';
import { LiveDarwinFeed } from './darwin/live.ts';
import { MockDarwinFeed } from './darwin/mock.ts';
import { LiveHspClient } from './hsp/live.ts';
import { MockHspClient } from './hsp/mock.ts';
import { LiveIncidentsFeed } from './incidents/live.ts';
import { MockIncidentsFeed } from './incidents/mock.ts';
import { ScenarioLibrary } from './mock/library.ts';
import { LiveNetworkRailFeed } from './network-rail/live.ts';
import { MockNetworkRailFeed } from './network-rail/mock.ts';
import { LiveReferenceData } from './reference/live.ts';
import { MockReferenceData } from './reference/mock.ts';

export type FeedMode = 'mock' | 'live';

export interface Feeds {
  clock: Clock;
  darwin: DarwinFeed;
  networkRail: NetworkRailFeed;
  hsp: HspClient;
  incidents: IncidentsFeed;
  reference: ReferenceDataSource;
  scenarios: string[];
}

function mode(env: NodeJS.ProcessEnv, name: string): FeedMode {
  const v = env[name] ?? 'mock';
  if (v !== 'mock' && v !== 'live') throw new Error(`${name} must be "mock" or "live"`);
  return v;
}

/** Builds the feed adapters selected by environment (each feed independently mock or live). */
export async function createFeeds(env: NodeJS.ProcessEnv = process.env): Promise<Feeds> {
  const modes = {
    darwin: mode(env, 'DARWIN_MODE'),
    networkRail: mode(env, 'NETWORK_RAIL_MODE'),
    hsp: mode(env, 'HSP_MODE'),
    incidents: mode(env, 'INCIDENTS_MODE'),
    reference: mode(env, 'REFERENCE_MODE'),
  };
  const anyMock = Object.values(modes).includes('mock');
  const library = anyMock ? await ScenarioLibrary.load(env.MOCK_SCENARIO) : null;
  const clock: Clock =
    modes.darwin === 'mock' || modes.networkRail === 'mock'
      ? new SimClock(env.MOCK_CLOCK_START ? new Date(env.MOCK_CLOCK_START) : new Date(), Number(env.MOCK_CLOCK_SPEED ?? 1))
      : systemClock;

  return {
    clock,
    darwin: modes.darwin === 'mock' ? new MockDarwinFeed(library!, clock) : new LiveDarwinFeed(),
    networkRail: modes.networkRail === 'mock' ? new MockNetworkRailFeed(library!, clock) : new LiveNetworkRailFeed(),
    hsp: modes.hsp === 'mock' ? new MockHspClient(library!) : new LiveHspClient(),
    incidents: modes.incidents === 'mock' ? new MockIncidentsFeed(library!) : new LiveIncidentsFeed(),
    reference: modes.reference === 'mock' ? new MockReferenceData() : new LiveReferenceData(),
    scenarios: library?.names ?? [],
  };
}
