/**
 * Alert engine: for a changed service, find the commutes it affects, decide
 * what's worth telling each user, record it (deduplicated) and hand the email
 * to the sender.
 */
import { createHash } from 'node:crypto';
import { alertLog, alertSettings, commutes, serviceCalls, services, user, type Db } from '@mct/db';
import { and, asc, desc, eq, inArray, sql } from '@mct/db/orm';
import { alertEmailMessage, type EmailMessage } from '@mct/email';
import {
  callView,
  decideAlerts,
  DEFAULT_ALERT_CONFIG,
  formatLondonHm,
  matchLeg,
  type AlertConfig,
  type AlertType,
  type CommuteForAlerts,
  type Leg,
  type RiskSummary,
} from '@mct/shared';
import { describeAlert } from './describe.ts';
import { Names } from './names.ts';

export interface EmailJob {
  message: EmailMessage;
  alertIds: string[];
}

export interface AlertEngineOptions {
  db: Db;
  now: () => Date;
  /** Public URLs for links in emails. */
  webURL: string;
  apiURL: string;
  enqueueEmail: (job: EmailJob) => Promise<void>;
  /** Disruption prediction for a leg (wired in Phase 6). */
  riskFor?: (serviceId: string, leg: Leg) => Promise<RiskSummary | null>;
  config?: AlertConfig;
}

const hm = (t: string) => t.slice(0, 5);

export function dedupeKey(userId: string, serviceId: string, type: AlertType, value: string, previousAlertId: string | null): string {
  return createHash('sha256').update([userId, serviceId, type, value, previousAlertId ?? ''].join('|')).digest('hex');
}

export class AlertEngine {
  private readonly names: Names;

  constructor(private readonly o: AlertEngineOptions) {
    this.names = new Names(o.db);
  }

  /** Evaluates one service. Returns the number of emails queued. */
  async evaluate(serviceId: string): Promise<number> {
    const { db } = this.o;
    const now = this.o.now();
    const [svc] = await db.select().from(services).where(eq(services.id, serviceId));
    if (!svc) return 0;
    const names = await this.names.ensure();
    const rows = await db.select().from(serviceCalls).where(eq(serviceCalls.serviceId, serviceId)).orderBy(asc(serviceCalls.seq));
    const calls = rows.map((c) => callView({ ...c, crs: c.crs?.trim() ?? null }, names.location(c.tiploc, c.crs)));
    const crs = [...new Set(calls.filter((c) => c.crs && c.activity !== 'pass').map((c) => c.crs!))];
    if (crs.length < 2) return 0;

    // Commutes with alerts on whose stations both appear on this train, for verified users.
    const candidates = await db
      .select({ c: commutes, s: alertSettings, email: user.email })
      .from(commutes)
      .innerJoin(alertSettings, eq(alertSettings.commuteId, commutes.id))
      .innerJoin(user, eq(user.id, commutes.userId))
      .where(
        and(
          eq(alertSettings.enabled, true),
          eq(user.emailVerified, true),
          inArray(commutes.homeCrs, crs),
          inArray(commutes.workCrs, crs),
        ),
      )
      .orderBy(desc(commutes.isDefault), asc(commutes.createdAt));

    // One leg per user: their first matching commute (default first).
    const perUser = new Map<string, { commute: CommuteForAlerts; leg: Leg; email: string; token: string }>();
    for (const { c, s, email } of candidates) {
      if (perUser.has(c.userId)) continue;
      const commute: CommuteForAlerts = {
        commuteId: c.id,
        userId: c.userId,
        homeCrs: c.homeCrs.trim(),
        workCrs: c.workCrs.trim(),
        outbound: { start: hm(c.outboundStart), end: hm(c.outboundEnd) },
        return: { start: hm(c.returnStart), end: hm(c.returnEnd) },
        activeDaysMask: c.activeDays,
        operatorCodes: c.operatorCodes,
        settings: {
          enabled: s.enabled,
          types: s.types,
          delayThresholdMin: s.delayThresholdMin,
          quietHours: s.quietStart && s.quietEnd ? { start: hm(s.quietStart), end: hm(s.quietEnd) } : null,
        },
      };
      const leg = matchLeg(commute, svc.toc.trim(), calls);
      if (leg) perUser.set(c.userId, { commute, leg, email, token: s.unsubscribeToken });
    }
    if (!perUser.size) return 0;

    // Last alert sent per (user, type) for this service.
    const sent = await db
      .selectDistinctOn([alertLog.userId, alertLog.type], { id: alertLog.id, userId: alertLog.userId, type: alertLog.type, value: alertLog.value })
      .from(alertLog)
      .where(and(eq(alertLog.serviceId, serviceId), inArray(alertLog.userId, [...perUser.keys()])))
      .orderBy(alertLog.userId, alertLog.type, desc(alertLog.sentAt), desc(sql`${alertLog.id}`));
    const last = new Map(sent.map((r) => [`${r.userId}|${r.type}`, r]));

    let queued = 0;
    for (const [userId, { commute, leg, email, token }] of perUser) {
      const risk = commute.settings.types.includes('predicted_disruption') && this.o.riskFor ? await this.o.riskFor(serviceId, leg) : null;
      const lastSent: Partial<Record<AlertType, string>> = {};
      for (const t of commute.settings.types) {
        const r = last.get(`${userId}|${t}`);
        if (r) lastSent[t] = r.value;
      }
      const decisions = decideAlerts({
        leg,
        settings: commute.settings,
        now,
        lastSent,
        risk: risk?.risk ?? null,
        cfg: this.o.config ?? DEFAULT_ALERT_CONFIG,
      });
      if (!decisions.length) continue;

      // Record first: the unique dedupe key makes concurrent evaluations send once.
      const inserted = await db
        .insert(alertLog)
        .values(
          decisions.map((d) => ({
            userId,
            commuteId: commute.commuteId,
            serviceId,
            type: d.type,
            value: d.value,
            dedupeKey: dedupeKey(userId, serviceId, d.type, d.value, last.get(`${userId}|${d.type}`)?.id ?? null),
            sentAt: now,
          })),
        )
        .onConflictDoNothing({ target: alertLog.dedupeKey })
        .returning({ id: alertLog.id, type: alertLog.type });
      if (!inserted.length) continue;
      const fresh = decisions.filter((d) => inserted.some((i) => i.type === d.type));

      const reason = leg.from.isCancelled ? leg.from.reason ?? svc.cancelReason : leg.to.reason ?? leg.from.reason ?? svc.delayReason;
      const sched = leg.from.departure.scheduled;
      const unsubscribe = `${this.o.apiURL}/api/unsubscribe?token=${encodeURIComponent(token)}`;
      const message = alertEmailMessage({
        to: email,
        train: `${sched ? formatLondonHm(new Date(sched)) : ''} ${leg.from.name} to ${leg.to.name}`.trim(),
        operator: names.operator(svc.toc),
        lines: fresh.map((d) => describeAlert(d, leg, { reason, risk })),
        serviceUrl: `${this.o.webURL}/services/${serviceId}?from=${leg.from.crs}&to=${leg.to.crs}`,
        settingsUrl: `${this.o.webURL}/commutes/${commute.commuteId}`,
        unsubscribeUrl: unsubscribe,
        unsubscribePostUrl: unsubscribe,
      });
      await this.o.enqueueEmail({ message, alertIds: inserted.map((i) => i.id) });
      queued++;
    }
    return queued;
  }
}
