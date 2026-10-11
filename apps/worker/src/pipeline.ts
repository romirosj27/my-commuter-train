import { associations, services, type Db } from '@mct/db';
import { and, eq, inArray } from '@mct/db/orm';
import { DarwinIngestor, type ServiceChange } from './ingest/darwin.ts';
import { NetworkIngestor } from './ingest/network.ts';
import { WatchedStations } from './ingest/watched.ts';
import type { IngestJob } from './jobs/queues.ts';

/** Routes ingest jobs to the right ingestor and reports changed services. */
export class IngestPipeline {
  readonly watched: WatchedStations;
  readonly darwin: DarwinIngestor;
  readonly network: NetworkIngestor;

  constructor(
    private readonly db: Db,
    now: () => Date,
    private readonly onChanges: (changes: ServiceChange[]) => Promise<void> = async () => {},
  ) {
    this.watched = new WatchedStations(db);
    this.darwin = new DarwinIngestor(db, this.watched);
    this.network = new NetworkIngestor(db, now);
  }

  async handle(job: IngestJob): Promise<ServiceChange[]> {
    if (job.source === 'network') {
      await this.network.handle(job.event);
      return [];
    }
    const changes = await this.darwin.handle(job.event);
    if (!changes.length) return changes;
    const all = [...changes, ...(await this.formedBy(changes))];
    await this.onChanges(all);
    return all;
  }

  /** Services formed by the changed ones: their knock-on risk depends on them. */
  private async formedBy(changes: ServiceChange[]): Promise<ServiceChange[]> {
    const rows = await this.db
      .select({ serviceId: services.id, feedId: services.feedId })
      .from(associations)
      .innerJoin(services, eq(services.feedId, associations.assocFeedId))
      .where(and(inArray(associations.mainFeedId, changes.map((c) => c.feedId)), eq(associations.kind, 'forms')));
    const seen = new Set(changes.map((c) => c.serviceId));
    return rows.filter((r) => !seen.has(r.serviceId)).map((r) => ({ ...r, kinds: ['forming' as const] }));
  }
}
