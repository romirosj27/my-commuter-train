import type { Incident, IncidentsFeed } from '@mct/shared';
import type { ScenarioLibrary } from '../mock/library.ts';

export class MockIncidentsFeed implements IncidentsFeed {
  readonly mode = 'mock' as const;
  constructor(private readonly library: ScenarioLibrary) {}

  /** Incidents published by `now` that have not ended. */
  async fetchActive(now: Date): Promise<Incident[]> {
    const iso = now.toISOString();
    return this.library
      .incidents(this.library.datesAround(now))
      .filter((i) => i.startsAt <= iso && (i.endsAt === null || i.endsAt > iso));
  }
}
