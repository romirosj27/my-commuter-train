import { commutes, delayRepaySchemes, journeys, operators, serviceCalls, services, type Db } from '@mct/db';
import { and, asc, desc, eq, gte, lte } from '@mct/db/orm';
import {
  arrivalDelayMin,
  assessEligibility,
  formatLondonHm,
  resolveNear,
  resolveTimeline,
  toLondon,
  type Eligibility,
  type TicketType,
} from '@mct/shared';
import { HttpError, notFound } from '../lib/http.ts';
import { getBoard } from './board.ts';
import type { ReferenceCache } from './reference.ts';

type JourneyRow = typeof journeys.$inferSelect;
type SchemeRow = typeof delayRepaySchemes.$inferSelect;

export interface JourneyDto {
  id: string;
  travelDate: string;
  originCrs: string;
  originName: string;
  destCrs: string;
  destName: string;
  toc: string;
  operator: string;
  schedDep: string;
  schedArr: string;
  actualArr: string | null;
  arrivalDelayMin: number | null;
  destCancelled: boolean;
  ticketType: TicketType;
  claimStatus: 'none' | 'claimed' | 'paid' | 'rejected';
  source: 'live' | 'hsp' | 'manual';
  serviceId: string | null;
  eligibility: Eligibility;
  claimUrl: string | null;
}

export interface SuggestionDto {
  direction: 'outbound' | 'return';
  commuteId: string;
  serviceId: string;
  /** "usual": matches the train you log most often; "first": the first train in your window (no history yet). */
  basis: 'usual' | 'first';
  travelDate: string;
  originCrs: string;
  originName: string;
  destCrs: string;
  destName: string;
  toc: string;
  operator: string;
  schedDep: string;
  schedArr: string;
  actualArr: string | null;
  destCancelled: boolean;
}

export interface ManualJourney {
  travelDate: string;
  originCrs: string;
  destCrs: string;
  toc: string;
  schedDep: string;
  schedArr: string;
  actualArr: string | null;
  ticketType: TicketType;
}

const trim = (s: string) => s.trim();

export class JourneyService {
  constructor(
    private readonly db: Db,
    private readonly ref: ReferenceCache,
  ) {}

  private async schemes(): Promise<Map<string, SchemeRow>> {
    const rows = await this.db.select().from(delayRepaySchemes);
    return new Map(rows.map((r) => [r.toc.trim(), r]));
  }

  private async claimUrls(): Promise<Map<string, string | null>> {
    const rows = await this.db.select({ code: operators.code, claimUrl: operators.claimUrl }).from(operators);
    return new Map(rows.map((r) => [r.code.trim(), r.claimUrl]));
  }

  private toDto(j: JourneyRow, schemes: Map<string, SchemeRow>, claimUrls: Map<string, string | null>): JourneyDto {
    const toc = j.toc.trim();
    const scheme = schemes.get(toc) ?? null;
    return {
      id: j.id,
      travelDate: j.travelDate,
      originCrs: trim(j.originCrs),
      originName: this.ref.station(trim(j.originCrs)),
      destCrs: trim(j.destCrs),
      destName: this.ref.station(trim(j.destCrs)),
      toc,
      operator: this.ref.operator(toc),
      schedDep: j.schedDep.toISOString(),
      schedArr: j.schedArr.toISOString(),
      actualArr: j.actualArr?.toISOString() ?? null,
      arrivalDelayMin: j.arrivalDelayMin,
      destCancelled: j.destCancelled,
      ticketType: j.ticketType,
      claimStatus: j.claimStatus,
      source: j.source,
      serviceId: j.serviceId,
      eligibility: assessEligibility({
        schedArr: j.schedArr,
        actualArr: j.actualArr,
        destCancelled: j.destCancelled,
        ticketType: j.ticketType,
        scheme: scheme ? { name: scheme.name, bands: scheme.bands, verifiedOn: scheme.verifiedOn } : null,
      }),
      claimUrl: scheme?.claimUrl ?? claimUrls.get(toc) ?? null,
    };
  }

  async list(userId: string, from?: string, to?: string): Promise<JourneyDto[]> {
    await this.ref.ensure();
    const rows = await this.db
      .select()
      .from(journeys)
      .where(
        and(
          eq(journeys.userId, userId),
          eq(journeys.status, 'confirmed'),
          from ? gte(journeys.travelDate, from) : undefined,
          to ? lte(journeys.travelDate, to) : undefined,
        ),
      )
      .orderBy(desc(journeys.travelDate), desc(journeys.schedDep));
    const [schemes, urls] = await Promise.all([this.schemes(), this.claimUrls()]);
    return rows.map((r) => this.toDto(r, schemes, urls));
  }

  async get(userId: string, id: string): Promise<JourneyDto> {
    await this.ref.ensure();
    const [row] = await this.db.select().from(journeys).where(and(eq(journeys.userId, userId), eq(journeys.id, id)));
    if (!row) throw notFound('Journey');
    const [schemes, urls] = await Promise.all([this.schemes(), this.claimUrls()]);
    return this.toDto(row, schemes, urls);
  }

  /** The user's journey on a known service: times copied from the live data. */
  async createFromService(
    userId: string,
    input: { serviceId: string; originCrs: string; destCrs: string; ticketType: TicketType; commuteId?: string | null },
  ): Promise<JourneyDto> {
    const [svc] = await this.db.select().from(services).where(eq(services.id, input.serviceId));
    if (!svc) throw notFound('Service');
    const calls = await this.db.select().from(serviceCalls).where(eq(serviceCalls.serviceId, svc.id)).orderBy(asc(serviceCalls.seq));
    const i = calls.findIndex((c) => c.crs?.trim() === input.originCrs && c.activity !== 'pass' && c.schedDep);
    const j = calls.findIndex((c, k) => k > i && c.crs?.trim() === input.destCrs && c.activity !== 'pass' && c.schedArr);
    if (i < 0 || j < 0) throw new HttpError(400, 'That train does not run between those stations');
    const dep = calls[i]!;
    const arr = calls[j]!;
    const destCancelled = svc.isCancelled || arr.isCancelled;
    const actualArr = destCancelled ? null : arr.actualArr;
    const [row] = await this.db
      .insert(journeys)
      .values({
        userId,
        commuteId: input.commuteId ?? null,
        serviceId: svc.id,
        travelDate: toLondon(dep.schedDep!).date,
        originCrs: input.originCrs,
        destCrs: input.destCrs,
        toc: svc.toc.trim(),
        schedDep: dep.schedDep!,
        schedArr: arr.schedArr!,
        actualArr,
        arrivalDelayMin: arrivalDelayMin(arr.schedArr!, actualArr),
        destCancelled,
        status: 'confirmed',
        ticketType: input.ticketType,
        source: 'live',
      })
      .onConflictDoNothing()
      .returning({ id: journeys.id });
    if (!row) throw new HttpError(409, "You've already logged this journey");
    return this.get(userId, row.id);
  }

  /** A journey the user enters themselves (London times; the arrival may be after midnight). */
  async createManual(userId: string, m: ManualJourney): Promise<JourneyDto> {
    await this.ref.ensure();
    for (const crs of [m.originCrs, m.destCrs]) {
      if (this.ref.station(crs) === crs) throw new HttpError(400, `Unknown station ${crs}`);
    }
    const [schedDep, schedArr] = resolveTimeline(m.travelDate, [m.schedDep, m.schedArr]) as [Date, Date];
    if (schedArr.getTime() <= schedDep.getTime()) throw new HttpError(400, 'Arrival must be after departure');
    const actualArr = m.actualArr ? resolveNear(schedArr, m.actualArr) : null;
    const [row] = await this.db
      .insert(journeys)
      .values({
        userId,
        travelDate: m.travelDate,
        originCrs: m.originCrs,
        destCrs: m.destCrs,
        toc: m.toc,
        schedDep,
        schedArr,
        actualArr,
        arrivalDelayMin: arrivalDelayMin(schedArr, actualArr),
        status: 'confirmed',
        ticketType: m.ticketType,
        source: 'manual',
      })
      .returning({ id: journeys.id });
    return this.get(userId, row!.id);
  }

  async update(
    userId: string,
    id: string,
    patch: { actualArr?: string | null; ticketType?: TicketType; claimStatus?: JourneyDto['claimStatus'] },
  ): Promise<JourneyDto> {
    const [row] = await this.db.select().from(journeys).where(and(eq(journeys.userId, userId), eq(journeys.id, id)));
    if (!row) throw notFound('Journey');
    const set: Partial<JourneyRow> = {};
    if (patch.actualArr !== undefined) {
      set.actualArr = patch.actualArr ? resolveNear(row.schedArr, patch.actualArr) : null;
      set.arrivalDelayMin = arrivalDelayMin(row.schedArr, set.actualArr);
    }
    if (patch.ticketType) set.ticketType = patch.ticketType;
    if (patch.claimStatus) set.claimStatus = patch.claimStatus;
    if (Object.keys(set).length) await this.db.update(journeys).set(set).where(eq(journeys.id, id));
    return this.get(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    const deleted = await this.db
      .delete(journeys)
      .where(and(eq(journeys.userId, userId), eq(journeys.id, id)))
      .returning({ id: journeys.id });
    if (!deleted.length) throw notFound('Journey');
  }

  /** The departure time and operator the user logs most often between two stations. */
  private async usualTrain(userId: string, originCrs: string, destCrs: string): Promise<{ hm: string; toc: string } | null> {
    const rows = await this.db
      .select({ schedDep: journeys.schedDep, toc: journeys.toc })
      .from(journeys)
      .where(and(eq(journeys.userId, userId), eq(journeys.status, 'confirmed'), eq(journeys.originCrs, originCrs), eq(journeys.destCrs, destCrs)))
      .orderBy(desc(journeys.travelDate))
      .limit(60);
    const counts = new Map<string, number>();
    for (const r of rows) {
      const k = `${formatLondonHm(r.schedDep)}|${r.toc.trim()}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const best = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (!best) return null;
    const [hm, toc] = best[0].split('|') as [string, string];
    return { hm, toc };
  }

  /**
   * One suggested journey per direction of the user's commute for a date:
   * their usual train if they have logged one, else the first train in the
   * window. Directions already logged that day are skipped. Nothing is
   * saved until the user confirms.
   */
  async suggestions(userId: string, date: string, commuteId?: string): Promise<SuggestionDto[]> {
    await this.ref.ensure();
    const rows = await this.db
      .select()
      .from(commutes)
      .where(and(eq(commutes.userId, userId), commuteId ? eq(commutes.id, commuteId) : eq(commutes.isDefault, true)));
    const c = rows[0];
    if (!c) return [];
    const logged = await this.db
      .select({ originCrs: journeys.originCrs, destCrs: journeys.destCrs })
      .from(journeys)
      .where(and(eq(journeys.userId, userId), eq(journeys.travelDate, date), eq(journeys.status, 'confirmed')));
    const out: SuggestionDto[] = [];
    for (const direction of ['outbound', 'return'] as const) {
      const [from, to] = direction === 'outbound' ? [c.homeCrs.trim(), c.workCrs.trim()] : [c.workCrs.trim(), c.homeCrs.trim()];
      if (logged.some((l) => l.originCrs.trim() === from && l.destCrs.trim() === to)) continue;
      const [start, end] = direction === 'outbound' ? [c.outboundStart, c.outboundEnd] : [c.returnStart, c.returnEnd];
      const board = await getBoard(this.db, this.ref, {
        fromCrs: from,
        toCrs: to,
        date,
        start: start.slice(0, 5),
        end: end.slice(0, 5),
        operators: c.operatorCodes,
      });
      if (!board.length) continue;
      const usual = await this.usualTrain(userId, from, to);
      const match = usual && board.find((s) => formatLondonHm(new Date(s.from.departure.scheduled!)) === usual.hm && s.toc === usual.toc);
      const pick = match ?? (usual ? null : board[0]);
      if (!pick) continue;
      out.push({
        direction,
        commuteId: c.id,
        serviceId: pick.serviceId,
        basis: match ? 'usual' : 'first',
        travelDate: date,
        originCrs: from,
        originName: pick.from.name,
        destCrs: to,
        destName: pick.to.name,
        toc: pick.toc,
        operator: pick.operator,
        schedDep: pick.from.departure.scheduled!,
        schedArr: pick.to.arrival.scheduled!,
        actualArr: pick.to.isCancelled ? null : pick.to.arrival.isActual ? pick.to.arrival.expected : null,
        destCancelled: pick.to.isCancelled,
      });
    }
    return out;
  }
}
