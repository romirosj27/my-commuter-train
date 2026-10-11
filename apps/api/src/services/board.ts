import { associations, serviceCalls, services, type Db } from '@mct/db';
import {
  addDays,
  callView,
  fromLondon,
  journeyStatus,
  type BoardService,
  type LinkedService,
  type ServiceDetail,
  type StoredCall,
} from '@mct/shared';
import { aliasedTable, and, asc, eq, gt, gte, inArray, lt, ne } from '@mct/db/orm';
import type { ReferenceCache } from './reference.ts';

export interface BoardQuery {
  fromCrs: string;
  toCrs: string;
  /** London calendar date of the window start. */
  date: string;
  /** London wall-clock window [start, end); end <= start wraps past midnight. */
  start: string;
  end: string;
  operators: string[];
}

export function windowInstants(date: string, start: string, end: string): { from: Date; to: Date } {
  const endDate = end <= start ? addDays(date, 1) : date;
  return { from: fromLondon(date, start), to: fromLondon(endDate, end) };
}

type CallRow = typeof serviceCalls.$inferSelect;
type ServiceRow = typeof services.$inferSelect;

const stored = (c: CallRow): StoredCall => ({ ...c, crs: c.crs?.trim() ?? null });

/** Services departing `fromCrs` within the window that later call at `toCrs`, ordered by departure. */
export async function getBoard(db: Db, ref: ReferenceCache, q: BoardQuery): Promise<BoardService[]> {
  await ref.ensure();
  const { from, to } = windowInstants(q.date, q.start, q.end);
  const dep = aliasedTable(serviceCalls, 'dep');
  const arr = aliasedTable(serviceCalls, 'arr');

  const rows = await db
    .selectDistinctOn([dep.serviceId], { service: services, dep, arr })
    .from(dep)
    .innerJoin(services, eq(services.id, dep.serviceId))
    .innerJoin(
      arr,
      and(eq(arr.serviceId, dep.serviceId), gt(arr.seq, dep.seq), eq(arr.crs, q.toCrs), ne(arr.activity, 'pass')),
    )
    .where(
      and(
        eq(dep.crs, q.fromCrs),
        ne(dep.activity, 'pass'),
        ne(dep.activity, 'destination'),
        gte(dep.schedDep, from),
        lt(dep.schedDep, to),
        q.operators.length ? inArray(services.toc, q.operators) : undefined,
      ),
    )
    .orderBy(asc(dep.serviceId), asc(dep.seq), asc(arr.seq));

  return rows
    .map(({ service, dep: d, arr: a }) => toBoardService(ref, service, d, a))
    .sort((x, y) => (x.from.departure.scheduled ?? '').localeCompare(y.from.departure.scheduled ?? ''));
}

function toBoardService(ref: ReferenceCache, s: ServiceRow, d: CallRow, a: CallRow): BoardService {
  const from = callView(stored(d), ref.location(d.tiploc, d.crs));
  const to = callView(stored(a), ref.location(a.tiploc, a.crs));
  const { status, progress, delayMin } = journeyStatus(from, to);
  return {
    serviceId: s.id,
    headcode: s.headcode,
    toc: s.toc.trim(),
    operator: ref.operator(s.toc),
    origin: ref.location(s.originTiploc),
    destination: ref.location(s.destTiploc),
    from,
    to,
    status,
    progress,
    delayMin,
    reason:
      status === 'cancelled'
        ? (from.reason ?? s.cancelReason)
        : status === 'part_cancelled'
          ? (to.reason ?? s.cancelReason)
          : (to.reason ?? from.reason ?? s.delayReason),
  };
}

async function callsFor(db: Db, serviceId: string): Promise<CallRow[]> {
  return db.select().from(serviceCalls).where(eq(serviceCalls.serviceId, serviceId)).orderBy(asc(serviceCalls.seq));
}

async function linked(db: Db, ref: ReferenceCache, feedId: string, tiploc: string, side: 'arr' | 'dep'): Promise<LinkedService | null> {
  const [s] = await db.select().from(services).where(eq(services.feedId, feedId));
  if (!s) return null;
  const calls = await callsFor(db, s.id);
  // The inbound service's last call at the location (its arrival); the onward service's first (its departure).
  const at = side === 'arr' ? calls.findLast((c) => c.tiploc === tiploc) : calls.find((c) => c.tiploc === tiploc);
  return {
    serviceId: s.id,
    headcode: s.headcode,
    toc: s.toc.trim(),
    origin: ref.location(s.originTiploc),
    destination: ref.location(s.destTiploc),
    isCancelled: s.isCancelled,
    at: at ? callView(stored(at), ref.location(at.tiploc, at.crs)) : null,
  };
}

export async function getServiceDetail(db: Db, ref: ReferenceCache, id: string): Promise<ServiceDetail | null> {
  await ref.ensure();
  const [s] = await db.select().from(services).where(eq(services.id, id));
  if (!s) return null;
  const calls = await callsFor(db, s.id);
  const [formedBy] = await db
    .select()
    .from(associations)
    .where(and(eq(associations.assocFeedId, s.feedId), eq(associations.kind, 'forms')));
  const [forms] = await db
    .select()
    .from(associations)
    .where(and(eq(associations.mainFeedId, s.feedId), eq(associations.kind, 'forms')));

  return {
    serviceId: s.id,
    headcode: s.headcode,
    toc: s.toc.trim(),
    operator: ref.operator(s.toc),
    ssd: s.ssd,
    origin: ref.location(s.originTiploc),
    destination: ref.location(s.destTiploc),
    isCancelled: s.isCancelled,
    reason: s.isCancelled ? s.cancelReason : s.delayReason,
    calls: calls.map((c) => callView(stored(c), ref.location(c.tiploc, c.crs))),
    formedBy: formedBy ? await linked(db, ref, formedBy.mainFeedId, formedBy.tiploc, 'arr') : null,
    forms: forms ? await linked(db, ref, forms.assocFeedId, forms.tiploc, 'dep') : null,
  };
}
