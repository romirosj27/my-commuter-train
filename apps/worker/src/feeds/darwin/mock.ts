import type { DarwinEvent, DarwinFeed, FeedHealth } from '@mct/shared';
import type { Clock } from '../../lib/clock.ts';
import type { ScenarioLibrary } from '../mock/library.ts';
import { Replayer, type ReplayOptions } from '../mock/replayer.ts';
import { reduce } from '../mock/state.ts';

export function darwinEventKey(e: DarwinEvent): string {
  switch (e.kind) {
    case 'schedule':
      return `s|${e.service.feedId}|${e.at}`;
    case 'association':
      return `a|${e.mainFeedId}|${e.assocFeedId}|${e.at}`;
    default:
      return `${e.kind}|${e.feedId}|${e.at}|${JSON.stringify(e)}`;
  }
}

/** Replays fixture scenarios as Darwin events. */
export class MockDarwinFeed implements DarwinFeed {
  readonly name = 'darwin';
  private replayer: Replayer<DarwinEvent>;

  constructor(
    private readonly library: ScenarioLibrary,
    private readonly clock: Clock,
    opts?: ReplayOptions,
  ) {
    this.replayer = new Replayer(
      'darwin',
      clock,
      (now) => library.darwinEvents(library.datesAround(now)),
      darwinEventKey,
      opts,
    );
  }

  onEvent(handler: (e: DarwinEvent) => Promise<void>): void {
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

  /**
   * Events (as of the clock's now) for services with a call at one of `crs`
   * scheduled between `from` and `to`.
   */
  async *snapshot(crs: ReadonlyArray<string>, from: Date, to: Date): AsyncIterable<DarwinEvent> {
    const nowIso = this.clock.now().toISOString();
    const dates = this.library.datesAround(from);
    const due = this.library.darwinEvents(dates).filter((e) => e.at <= nowIso);
    const state = reduce(due);
    const wanted = new Set(crs);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();
    const matching = new Set<string>();
    for (const [feedId, s] of state) {
      const hit = s.calls.some((c) => {
        if (!c.crs || !wanted.has(c.crs)) return false;
        const t = c.schedDep ?? c.schedArr;
        return t !== null && t >= fromIso && t <= toIso;
      });
      if (hit) matching.add(feedId);
    }
    for (const e of due) {
      const ids = e.kind === 'schedule' ? [e.service.feedId] : e.kind === 'association' ? [e.mainFeedId, e.assocFeedId] : [e.feedId];
      if (ids.some((id) => matching.has(id))) yield e;
    }
  }
}
