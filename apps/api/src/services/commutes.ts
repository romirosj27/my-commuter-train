import { randomBytes } from 'node:crypto';
import { alertSettings, commutes, type Db } from '@mct/db';
import {
  commuteInputSchema,
  DEFAULT_ALERT_SETTINGS,
  weekdayMask,
  weekdaysFromMask,
  type AlertSettingsInput,
  type CommuteDto,
  type CommuteInput,
  type CommutePatch,
} from '@mct/shared';
import { and, asc, eq, ne } from '@mct/db/orm';
import { HttpError, notFound, parse } from '../lib/http.ts';
import type { ReferenceCache } from './reference.ts';

export const MAX_COMMUTES_PER_USER = 10;

type CommuteRow = typeof commutes.$inferSelect;
type SettingsRow = typeof alertSettings.$inferSelect;

const hm = (t: string) => t.slice(0, 5);

export function newUnsubscribeToken(): string {
  return randomBytes(24).toString('base64url');
}

function settingsDto(s: SettingsRow | undefined): AlertSettingsInput {
  if (!s) return DEFAULT_ALERT_SETTINGS;
  return {
    enabled: s.enabled,
    types: s.types,
    delayThresholdMin: s.delayThresholdMin,
    quietHours: s.quietStart && s.quietEnd ? { start: hm(s.quietStart), end: hm(s.quietEnd) } : null,
  };
}

function settingsRow(s: AlertSettingsInput) {
  return {
    enabled: s.enabled,
    types: s.types,
    delayThresholdMin: s.delayThresholdMin,
    quietStart: s.quietHours?.start ?? null,
    quietEnd: s.quietHours?.end ?? null,
  };
}

function toDto(ref: ReferenceCache, c: CommuteRow, s: SettingsRow | undefined): CommuteDto {
  const home = c.homeCrs.trim();
  const work = c.workCrs.trim();
  return {
    id: c.id,
    name: c.name,
    homeCrs: home,
    homeName: ref.station(home),
    workCrs: work,
    workName: ref.station(work),
    outbound: { start: hm(c.outboundStart), end: hm(c.outboundEnd) },
    return: { start: hm(c.returnStart), end: hm(c.returnEnd) },
    activeDays: weekdaysFromMask(c.activeDays),
    operatorCodes: c.operatorCodes,
    isDefault: c.isDefault,
    alertSettings: settingsDto(s),
    createdAt: c.createdAt.toISOString(),
  };
}

function commuteRow(input: Omit<CommuteInput, 'alertSettings' | 'isDefault'>) {
  return {
    name: input.name,
    homeCrs: input.homeCrs,
    workCrs: input.workCrs,
    outboundStart: input.outbound.start,
    outboundEnd: input.outbound.end,
    returnStart: input.return.start,
    returnEnd: input.return.end,
    activeDays: weekdayMask(input.activeDays as Parameters<typeof weekdayMask>[0]),
    operatorCodes: input.operatorCodes,
  };
}

export class CommuteService {
  constructor(
    private readonly db: Db,
    private readonly ref: ReferenceCache,
  ) {}

  private async assertStations(...crs: string[]) {
    await this.ref.ensure();
    for (const c of crs) {
      if (this.ref.station(c) === c) throw new HttpError(400, 'Invalid request', [{ path: 'station', message: `Unknown station ${c}` }]);
    }
  }

  async list(userId: string): Promise<CommuteDto[]> {
    await this.ref.ensure();
    const rows = await this.db
      .select({ c: commutes, s: alertSettings })
      .from(commutes)
      .leftJoin(alertSettings, eq(alertSettings.commuteId, commutes.id))
      .where(eq(commutes.userId, userId))
      .orderBy(asc(commutes.createdAt));
    return rows.map((r) => toDto(this.ref, r.c, r.s ?? undefined));
  }

  async get(userId: string, id: string): Promise<CommuteDto> {
    await this.ref.ensure();
    const [r] = await this.db
      .select({ c: commutes, s: alertSettings })
      .from(commutes)
      .leftJoin(alertSettings, eq(alertSettings.commuteId, commutes.id))
      .where(and(eq(commutes.userId, userId), eq(commutes.id, id)));
    if (!r) throw notFound('Commute');
    return toDto(this.ref, r.c, r.s ?? undefined);
  }

  async create(userId: string, input: CommuteInput): Promise<CommuteDto> {
    await this.assertStations(input.homeCrs, input.workCrs);
    const id = await this.db.transaction(async (tx) => {
      const existing = await tx.select({ id: commutes.id }).from(commutes).where(eq(commutes.userId, userId)).for('update');
      if (existing.length >= MAX_COMMUTES_PER_USER) {
        throw new HttpError(409, `You can save up to ${MAX_COMMUTES_PER_USER} commutes`);
      }
      const isDefault = input.isDefault || existing.length === 0;
      if (isDefault) await tx.update(commutes).set({ isDefault: false }).where(eq(commutes.userId, userId));
      const [row] = await tx
        .insert(commutes)
        .values({ ...commuteRow(input), userId, isDefault })
        .returning({ id: commutes.id });
      await tx.insert(alertSettings).values({
        commuteId: row!.id,
        unsubscribeToken: newUnsubscribeToken(),
        ...settingsRow(input.alertSettings ?? DEFAULT_ALERT_SETTINGS),
      });
      return row!.id;
    });
    return this.get(userId, id);
  }

  async update(userId: string, id: string, patch: CommutePatch): Promise<CommuteDto> {
    const current = await this.get(userId, id);
    const merged = parse(commuteInputSchema, {
      name: patch.name ?? current.name,
      homeCrs: patch.homeCrs ?? current.homeCrs,
      workCrs: patch.workCrs ?? current.workCrs,
      outbound: patch.outbound ?? current.outbound,
      return: patch.return ?? current.return,
      activeDays: patch.activeDays ?? current.activeDays,
      operatorCodes: patch.operatorCodes ?? current.operatorCodes,
      isDefault: patch.isDefault ?? current.isDefault,
    });
    await this.assertStations(merged.homeCrs, merged.workCrs);
    await this.db.transaction(async (tx) => {
      if (merged.isDefault && !current.isDefault) {
        await tx.update(commutes).set({ isDefault: false }).where(eq(commutes.userId, userId));
      }
      // A user always keeps one default: un-defaulting is done by choosing another.
      await tx
        .update(commutes)
        .set({ ...commuteRow(merged), isDefault: merged.isDefault || current.isDefault })
        .where(and(eq(commutes.userId, userId), eq(commutes.id, id)));
    });
    return this.get(userId, id);
  }

  async setDefault(userId: string, id: string): Promise<CommuteDto> {
    await this.get(userId, id);
    await this.db.transaction(async (tx) => {
      await tx.update(commutes).set({ isDefault: false }).where(and(eq(commutes.userId, userId), ne(commutes.id, id)));
      await tx.update(commutes).set({ isDefault: true }).where(eq(commutes.id, id));
    });
    return this.get(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(commutes)
        .where(and(eq(commutes.userId, userId), eq(commutes.id, id)))
        .returning({ isDefault: commutes.isDefault });
      if (!deleted) throw notFound('Commute');
      if (deleted.isDefault) {
        const [next] = await tx
          .select({ id: commutes.id })
          .from(commutes)
          .where(eq(commutes.userId, userId))
          .orderBy(asc(commutes.createdAt))
          .limit(1);
        if (next) await tx.update(commutes).set({ isDefault: true }).where(eq(commutes.id, next.id));
      }
    });
  }

  async updateAlertSettings(userId: string, id: string, settings: AlertSettingsInput): Promise<CommuteDto> {
    await this.get(userId, id);
    await this.db
      .insert(alertSettings)
      .values({ commuteId: id, unsubscribeToken: newUnsubscribeToken(), ...settingsRow(settings) })
      .onConflictDoUpdate({ target: alertSettings.commuteId, set: settingsRow(settings) });
    return this.get(userId, id);
  }
}
