import { watchedCrs, type Db } from '@mct/db';

/** Cached set of stations in at least one user's commute (from the `watched_crs` view). */
export class WatchedStations {
  private cached: { at: number; crs: Set<string> } | null = null;

  constructor(
    private readonly db: Db,
    private readonly ttlMs = 60_000,
  ) {}

  async get(): Promise<Set<string>> {
    if (this.cached && Date.now() - this.cached.at < this.ttlMs) return this.cached.crs;
    const rows = await this.db.select().from(watchedCrs);
    this.cached = { at: Date.now(), crs: new Set(rows.map((r) => r.crs.trim())) };
    return this.cached.crs;
  }

  invalidate(): void {
    this.cached = null;
  }
}
