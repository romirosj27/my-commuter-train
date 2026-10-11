/**
 * Stores network-wide events (TRUST movements / cancellations) in a short
 * rolling buffer, for the upstream-disruption rule. Only events at locations
 * on the calling patterns of persisted services are kept.
 */
import { networkEvents, serviceCalls, services, tiplocs, type Db } from '@mct/db';
import type { NetworkEvent } from '@mct/shared';
import { eq, gte } from 'drizzle-orm';

export class NetworkIngestor {
  private routeTiplocs: { at: number; set: Set<string> } | null = null;
  private tiplocCrs: { at: number; map: Map<string, string | null> } | null = null;

  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = 60_000,
  ) {}

  private async onRoutes(tiploc: string): Promise<boolean> {
    if (!this.routeTiplocs || Date.now() - this.routeTiplocs.at > this.ttlMs) {
      const since = new Date(this.now().getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
      const rows = await this.db
        .selectDistinct({ tiploc: serviceCalls.tiploc })
        .from(serviceCalls)
        .innerJoin(services, eq(services.id, serviceCalls.serviceId))
        .where(gte(services.ssd, since));
      this.routeTiplocs = { at: Date.now(), set: new Set(rows.map((r) => r.tiploc)) };
    }
    return this.routeTiplocs.set.has(tiploc);
  }

  private async crsFor(tiploc: string): Promise<string | null> {
    if (!this.tiplocCrs || Date.now() - this.tiplocCrs.at > this.ttlMs * 10) {
      const rows = await this.db.select({ tiploc: tiplocs.tiploc, crs: tiplocs.crs }).from(tiplocs);
      this.tiplocCrs = { at: Date.now(), map: new Map(rows.map((r) => [r.tiploc, r.crs?.trim() ?? null])) };
    }
    return this.tiplocCrs.map.get(tiploc) ?? null;
  }

  /** Returns true if the event was stored. */
  async handle(e: NetworkEvent): Promise<boolean> {
    if (e.kind === 'berth_step') return false; // TD is not used by the MVP rules yet
    if (!e.tiploc || !(await this.onRoutes(e.tiploc))) return false;
    await this.db.insert(networkEvents).values({
      kind: e.kind,
      trainRef: e.trainRef,
      serviceFeedId: e.feedId,
      tiploc: e.tiploc,
      crs: await this.crsFor(e.tiploc),
      delayMin: e.kind === 'movement' ? e.delayMin : null,
      reason: e.kind === 'cancellation' ? e.reason : null,
      observedAt: new Date(e.at),
    });
    return true;
  }
}
