import { operators, stations, tiplocs, type Db } from '@mct/db';

/** In-memory copy of reference data for naming things on boards (refreshed periodically). */
export class ReferenceCache {
  private loadedAt = 0;
  private stationNames = new Map<string, string>();
  private tiplocNames = new Map<string, string>();
  private operatorNames = new Map<string, string>();
  private loading: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly ttlMs = 10 * 60_000,
  ) {}

  async ensure(): Promise<this> {
    if (Date.now() - this.loadedAt < this.ttlMs) return this;
    this.loading ??= this.load().finally(() => (this.loading = null));
    await this.loading;
    return this;
  }

  private async load(): Promise<void> {
    const [s, t, o] = await Promise.all([
      this.db.select({ crs: stations.crs, name: stations.name }).from(stations),
      this.db.select({ tiploc: tiplocs.tiploc, name: tiplocs.name, crs: tiplocs.crs }).from(tiplocs),
      this.db.select({ code: operators.code, name: operators.name }).from(operators),
    ]);
    this.stationNames = new Map(s.map((r) => [r.crs.trim(), r.name]));
    this.tiplocNames = new Map(t.map((r) => [r.tiploc, (r.crs && this.stationNames.get(r.crs.trim())) || r.name]));
    this.operatorNames = new Map(o.map((r) => [r.code.trim(), r.name]));
    this.loadedAt = Date.now();
  }

  station(crs: string): string {
    return this.stationNames.get(crs) ?? crs;
  }

  /** Display name for a location: the station name if it has one, else the TIPLOC's name, else the code. */
  location(tiploc: string | null, crs?: string | null): string {
    if (crs) {
      const s = this.stationNames.get(crs.trim());
      if (s) return s;
    }
    return (tiploc && this.tiplocNames.get(tiploc)) || tiploc || 'Unknown';
  }

  operator(code: string): string {
    return this.operatorNames.get(code.trim()) ?? code;
  }
}
