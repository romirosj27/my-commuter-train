import { operators, stations, tiplocs, type Db } from '@mct/db';

/** Cached display names for stations, TIPLOCs and operators. */
export class Names {
  private at = 0;
  private stationNames = new Map<string, string>();
  private tiplocNames = new Map<string, string>();
  private operatorNames = new Map<string, string>();

  constructor(
    private readonly db: Db,
    private readonly ttlMs = 10 * 60_000,
  ) {}

  async ensure(): Promise<this> {
    if (Date.now() - this.at < this.ttlMs) return this;
    const [s, t, o] = await Promise.all([
      this.db.select({ crs: stations.crs, name: stations.name }).from(stations),
      this.db.select({ tiploc: tiplocs.tiploc, name: tiplocs.name }).from(tiplocs),
      this.db.select({ code: operators.code, name: operators.name }).from(operators),
    ]);
    this.stationNames = new Map(s.map((r) => [r.crs.trim(), r.name]));
    this.tiplocNames = new Map(t.map((r) => [r.tiploc, r.name]));
    this.operatorNames = new Map(o.map((r) => [r.code.trim(), r.name]));
    this.at = Date.now();
    return this;
  }

  location(tiploc: string | null, crs: string | null): string {
    return (crs && this.stationNames.get(crs.trim())) || (tiploc && this.tiplocNames.get(tiploc)) || tiploc || 'Unknown';
  }

  operator(code: string): string {
    return this.operatorNames.get(code.trim()) ?? code;
  }
}
