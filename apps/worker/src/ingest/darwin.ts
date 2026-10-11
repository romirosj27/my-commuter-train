/**
 * Applies normalised Darwin events to the database.
 *
 * Only services relevant to a commute are persisted: those calling at a
 * watched station, plus services associated with one (e.g. the inbound
 * working that forms a watched service). Events for other services are dropped.
 */
import { associations, serviceCalls, services, type Db } from '@mct/db';
import type { CallRef, CallUpdate, DarwinEvent, NormalisedCall } from '@mct/shared';
import { and, eq, or, sql } from '@mct/db/orm';
import type { WatchedStations } from './watched.ts';

type CallRow = typeof serviceCalls.$inferSelect;
type AssociationEvent = Extract<DarwinEvent, { kind: 'association' }>;

export type ChangeKind =
  | 'schedule'
  | 'forecast'
  | 'actual'
  | 'platform'
  | 'cancellation'
  | 'reinstatement'
  | 'reason'
  | 'association'
  /** The service that forms this one changed (its knock-on prediction may have moved). */
  | 'forming';

export interface ServiceChange {
  serviceId: string;
  feedId: string;
  kinds: ChangeKind[];
}

const PENDING_ASSOCIATION_TTL_MS = 24 * 3600_000;

const REALTIME_FIELDS = [
  'fcstArr',
  'fcstDep',
  'actualArr',
  'actualDep',
  'platform',
  'platformConfirmed',
  'isCancelled',
  'cancelReason',
  'delayReason',
] as const satisfies ReadonlyArray<keyof CallRow & keyof CallUpdate>;

const KIND_OF_FIELD: Record<(typeof REALTIME_FIELDS)[number], ChangeKind> = {
  fcstArr: 'forecast',
  fcstDep: 'forecast',
  actualArr: 'actual',
  actualDep: 'actual',
  platform: 'platform',
  platformConfirmed: 'platform',
  isCancelled: 'cancellation',
  cancelReason: 'reason',
  delayReason: 'reason',
};

const DATE_FIELDS = new Set<string>(['fcstArr', 'fcstDep', 'actualArr', 'actualDep']);

function callKey(tiploc: string, sched: Date | string | null): string {
  const iso = sched === null ? '' : typeof sched === 'string' ? sched : sched.toISOString();
  return `${tiploc}|${iso}`;
}

export function matchCall(calls: CallRow[], ref: CallRef): CallRow | undefined {
  return calls.find(
    (c) =>
      c.tiploc === ref.tiploc &&
      (ref.sched === undefined ||
        c.schedDep?.toISOString() === ref.sched ||
        c.schedArr?.toISOString() === ref.sched),
  );
}

const toDate = (v: string | null | undefined) => (v == null ? null : new Date(v));
const same = (a: unknown, b: unknown) =>
  a instanceof Date || b instanceof Date
    ? (a as Date | null)?.getTime() === (b as Date | null)?.getTime()
    : a === b;

export class DarwinIngestor {
  /** Associations seen before either service was persisted, keyed by feed id. */
  private pending = new Map<string, Array<{ e: AssociationEvent; seenAt: number }>>();
  /** Schedules not (yet) relevant, kept only while a pending association names them. */
  private deferred = new Map<string, Extract<DarwinEvent, { kind: 'schedule' }>>();

  constructor(
    private readonly db: Db,
    private readonly watched: WatchedStations,
  ) {}

  async handle(e: DarwinEvent): Promise<ServiceChange[]> {
    switch (e.kind) {
      case 'schedule':
        return this.schedule(e);
      case 'update':
        return this.update(e);
      case 'cancellation':
        return this.cancellation(e);
      case 'reinstatement':
        return this.reinstatement(e);
      case 'association':
        return this.association(e);
    }
  }

  private async serviceId(feedId: string): Promise<string | null> {
    const [row] = await this.db.select({ id: services.id }).from(services).where(eq(services.feedId, feedId));
    return row?.id ?? null;
  }

  /** Whether a service with these calls should be persisted. */
  private async isRelevant(feedId: string, calls: NormalisedCall[]): Promise<boolean> {
    const watched = await this.watched.get();
    if (calls.some((c) => c.crs !== null && c.activity !== 'pass' && watched.has(c.crs))) return true;
    const [assoc] = await this.db
      .select({ one: sql`1` })
      .from(associations)
      .where(or(eq(associations.mainFeedId, feedId), eq(associations.assocFeedId, feedId)))
      .limit(1);
    return assoc !== undefined || (await this.serviceId(feedId)) !== null;
  }

  private async schedule(e: Extract<DarwinEvent, { kind: 'schedule' }>): Promise<ServiceChange[]> {
    const { service: svc, calls } = e;
    if (!svc.isPassenger) return [];
    if (!(await this.isRelevant(svc.feedId, calls))) {
      if (this.pending.has(svc.feedId)) this.deferred.set(svc.feedId, e);
      return [];
    }
    this.deferred.delete(svc.feedId);

    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(services)
        .values({
          feedId: svc.feedId,
          uid: svc.uid,
          ssd: svc.ssd,
          toc: svc.toc,
          headcode: svc.headcode,
          originTiploc: calls[0]?.tiploc ?? null,
          destTiploc: calls.at(-1)?.tiploc ?? null,
          lastFeedAt: new Date(e.at),
        })
        .onConflictDoUpdate({
          target: services.feedId,
          set: {
            uid: svc.uid,
            ssd: svc.ssd,
            toc: svc.toc,
            headcode: svc.headcode,
            originTiploc: calls[0]?.tiploc ?? null,
            destTiploc: calls.at(-1)?.tiploc ?? null,
            lastFeedAt: new Date(e.at),
          },
        })
        .returning({ id: services.id });
      const serviceId = row!.id;

      // Replace the calling pattern, carrying real-time data over to calls that still exist.
      const old = await tx.select().from(serviceCalls).where(eq(serviceCalls.serviceId, serviceId));
      const carried = new Map(old.map((c) => [callKey(c.tiploc, c.schedDep ?? c.schedArr), c]));
      await tx.delete(serviceCalls).where(eq(serviceCalls.serviceId, serviceId));
      if (calls.length) {
        await tx.insert(serviceCalls).values(
          calls.map((c, seq) => {
            const prev = carried.get(callKey(c.tiploc, c.schedDep ?? c.schedArr));
            return {
              serviceId,
              seq,
              tiploc: c.tiploc,
              crs: c.crs,
              activity: c.activity,
              isPublic: c.activity !== 'pass',
              schedArr: toDate(c.schedArr),
              schedDep: toDate(c.schedDep),
              platformBooked: c.platformBooked,
              platform: prev?.platform ?? c.platformBooked,
              platformConfirmed: prev?.platformConfirmed ?? false,
              fcstArr: prev?.fcstArr ?? null,
              fcstDep: prev?.fcstDep ?? null,
              actualArr: prev?.actualArr ?? null,
              actualDep: prev?.actualDep ?? null,
              isCancelled: prev?.isCancelled ?? false,
              cancelReason: prev?.cancelReason ?? null,
              delayReason: prev?.delayReason ?? null,
            };
          }),
        );
      }
      return serviceId;
    });

    const changes: ServiceChange[] = [{ serviceId: id, feedId: svc.feedId, kinds: ['schedule'] }];
    changes.push(...(await this.flushPending(svc.feedId)));
    return changes;
  }

  private async update(e: Extract<DarwinEvent, { kind: 'update' }>): Promise<ServiceChange[]> {
    const serviceId = await this.serviceId(e.feedId);
    if (!serviceId) return [];
    const kinds = new Set<ChangeKind>();

    await this.db.transaction(async (tx) => {
      const calls = await tx.select().from(serviceCalls).where(eq(serviceCalls.serviceId, serviceId));
      let serviceDelayReason: string | null | undefined;
      for (const u of e.calls) {
        const call = matchCall(calls, u);
        if (!call) continue;
        const set: Partial<CallRow> = {};
        for (const field of REALTIME_FIELDS) {
          const raw = u[field];
          if (raw === undefined) continue;
          const value = DATE_FIELDS.has(field) ? toDate(raw as string | null) : raw;
          if (same(call[field], value)) continue;
          (set as Record<string, unknown>)[field] = value;
          kinds.add(KIND_OF_FIELD[field]);
        }
        if (u.delayReason !== undefined) serviceDelayReason = u.delayReason;
        if (Object.keys(set).length) {
          await tx
            .update(serviceCalls)
            .set(set)
            .where(and(eq(serviceCalls.serviceId, serviceId), eq(serviceCalls.seq, call.seq)));
          Object.assign(call, set);
        }
      }
      await tx
        .update(services)
        .set({
          lastFeedAt: new Date(e.at),
          ...(serviceDelayReason !== undefined ? { delayReason: serviceDelayReason } : {}),
        })
        .where(eq(services.id, serviceId));
    });

    return kinds.size ? [{ serviceId, feedId: e.feedId, kinds: [...kinds] }] : [];
  }

  private async cancellation(e: Extract<DarwinEvent, { kind: 'cancellation' }>): Promise<ServiceChange[]> {
    const serviceId = await this.serviceId(e.feedId);
    if (!serviceId) return [];
    await this.db.transaction(async (tx) => {
      if (e.scope === 'full') {
        await tx
          .update(services)
          .set({ isCancelled: true, cancelReason: e.reason, lastFeedAt: new Date(e.at) })
          .where(eq(services.id, serviceId));
        await tx
          .update(serviceCalls)
          .set({ isCancelled: true, cancelReason: e.reason })
          .where(eq(serviceCalls.serviceId, serviceId));
      } else {
        const calls = await tx.select().from(serviceCalls).where(eq(serviceCalls.serviceId, serviceId));
        for (const ref of e.scope) {
          const call = matchCall(calls, ref);
          if (!call) continue;
          await tx
            .update(serviceCalls)
            .set({ isCancelled: true, cancelReason: e.reason })
            .where(and(eq(serviceCalls.serviceId, serviceId), eq(serviceCalls.seq, call.seq)));
        }
        await tx.update(services).set({ lastFeedAt: new Date(e.at) }).where(eq(services.id, serviceId));
      }
    });
    return [{ serviceId, feedId: e.feedId, kinds: ['cancellation'] }];
  }

  private async reinstatement(e: Extract<DarwinEvent, { kind: 'reinstatement' }>): Promise<ServiceChange[]> {
    const serviceId = await this.serviceId(e.feedId);
    if (!serviceId) return [];
    await this.db.transaction(async (tx) => {
      await tx
        .update(services)
        .set({ isCancelled: false, cancelReason: null, lastFeedAt: new Date(e.at) })
        .where(eq(services.id, serviceId));
      await tx
        .update(serviceCalls)
        .set({ isCancelled: false, cancelReason: null })
        .where(eq(serviceCalls.serviceId, serviceId));
    });
    return [{ serviceId, feedId: e.feedId, kinds: ['reinstatement'] }];
  }

  private async association(e: AssociationEvent): Promise<ServiceChange[]> {
    const [mainId, assocId] = await Promise.all([this.serviceId(e.mainFeedId), this.serviceId(e.assocFeedId)]);
    if (!mainId && !assocId) {
      this.remember(e);
      return [];
    }
    if (e.deleted) {
      await this.db
        .delete(associations)
        .where(
          and(
            eq(associations.mainFeedId, e.mainFeedId),
            eq(associations.assocFeedId, e.assocFeedId),
            eq(associations.kind, e.association),
          ),
        );
    } else {
      await this.db
        .insert(associations)
        .values({ mainFeedId: e.mainFeedId, assocFeedId: e.assocFeedId, kind: e.association, tiploc: e.tiploc })
        .onConflictDoUpdate({
          target: [associations.mainFeedId, associations.assocFeedId, associations.kind],
          set: { tiploc: e.tiploc, updatedAt: new Date() },
        });
    }
    // Report the change against whichever side(s) we hold; the formed service matters most.
    return [
      ...(assocId ? [{ serviceId: assocId, feedId: e.assocFeedId, kinds: ['association' as const] }] : []),
      ...(mainId ? [{ serviceId: mainId, feedId: e.mainFeedId, kinds: ['association' as const] }] : []),
    ];
  }

  private remember(e: AssociationEvent): void {
    const now = Date.now();
    for (const [k, list] of this.pending) {
      const fresh = list.filter((p) => now - p.seenAt < PENDING_ASSOCIATION_TTL_MS);
      if (fresh.length) this.pending.set(k, fresh);
      else this.pending.delete(k);
    }
    for (const k of this.deferred.keys()) if (!this.pending.has(k)) this.deferred.delete(k);
    for (const feedId of [e.mainFeedId, e.assocFeedId]) {
      const list = this.pending.get(feedId) ?? [];
      list.push({ e, seenAt: now });
      this.pending.set(feedId, list);
    }
  }

  private async flushPending(feedId: string): Promise<ServiceChange[]> {
    const list = this.pending.get(feedId);
    if (!list) return [];
    this.pending.delete(feedId);
    const out: ServiceChange[] = [];
    for (const { e } of list) {
      const other = e.mainFeedId === feedId ? e.assocFeedId : e.mainFeedId;
      const rest = this.pending.get(other)?.filter((p) => p.e !== e);
      if (rest?.length) this.pending.set(other, rest);
      else this.pending.delete(other);
      out.push(...(await this.association(e)));
      // The other side may have been seen earlier but not kept; it is relevant now.
      const def = this.deferred.get(other);
      if (def) {
        this.deferred.delete(other);
        out.push(...(await this.schedule(def)));
      }
    }
    return out;
  }
}
