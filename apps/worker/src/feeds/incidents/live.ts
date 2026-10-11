/** Live incidents feed. FEED-SCHEMA-PLACEHOLDER: source, format and auth not yet confirmed. */
import type { Incident, IncidentsFeed } from '@mct/shared';

export class LiveIncidentsFeed implements IncidentsFeed {
  readonly mode = 'live' as const;
  async fetchActive(): Promise<Incident[]> {
    throw new Error('Live incidents feed not implemented: set INCIDENTS_MODE=mock until the docs are supplied');
  }
}
