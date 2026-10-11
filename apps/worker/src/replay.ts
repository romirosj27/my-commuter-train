/**
 * Dev aid: replays the mock feeds to the console.
 *   pnpm --filter @mct/worker replay                       # today, real time
 *   MOCK_CLOCK_START=2026-11-10T06:30:00Z MOCK_CLOCK_SPEED=60 pnpm --filter @mct/worker replay
 */
import { formatLondonHm } from '@mct/shared';
import { createFeeds } from './feeds/index.ts';

const feeds = await createFeeds();
const ac = new AbortController();
process.on('SIGINT', () => ac.abort());
process.on('SIGTERM', () => ac.abort());

console.log(`scenarios: ${feeds.scenarios.join(', ')}; clock: ${feeds.clock.now().toISOString()}`);
const stamp = () => formatLondonHm(feeds.clock.now());

feeds.darwin.onEvent(async (e) => {
  const id = e.kind === 'schedule' ? e.service.feedId : e.kind === 'association' ? `${e.mainFeedId} -> ${e.assocFeedId}` : e.feedId;
  console.log(`[${stamp()}] darwin ${e.kind.padEnd(12)} ${id}`);
});
feeds.networkRail.onEvent(async (e) => {
  console.log(`[${stamp()}] network ${e.kind.padEnd(12)} ${'trainRef' in e ? e.trainRef : e.area}`);
});

await Promise.all([feeds.darwin.start(ac.signal), feeds.networkRail.start(ac.signal)]);
