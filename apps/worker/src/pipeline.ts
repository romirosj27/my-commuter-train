import type { Db } from '@mct/db';
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
    db: Db,
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
    if (changes.length) await this.onChanges(changes);
    return changes;
  }
}
