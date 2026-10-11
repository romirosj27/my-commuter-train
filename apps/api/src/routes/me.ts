import { alertLog, alertSettings, commutes, journeys, user } from '@mct/db';
import { eq, inArray } from '@mct/db/orm';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.ts';
import { userOf } from '../plugins/auth.ts';

export async function meRoutes(app: FastifyInstance, { db, now, adminEmails }: AppDeps & { adminEmails: Set<string> }) {
  const auth = { preHandler: app.requireUser };

  app.get('/api/me', auth, async (req) => {
    const u = userOf(req);
    return { id: u.id, email: u.email, name: u.name, isAdmin: adminEmails.has(u.email.toLowerCase()) };
  });

  /**
   * GDPR data export: everything we hold about the user, as JSON.
   * Account deletion is Better Auth's POST /api/auth/delete-user (cascades in the database).
   */
  app.get('/api/me/export', auth, async (req, reply) => {
    const { id } = userOf(req);
    const [profile] = await db
      .select({ id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified, timezone: user.timezone, createdAt: user.createdAt })
      .from(user)
      .where(eq(user.id, id));
    const userCommutes = await db.select().from(commutes).where(eq(commutes.userId, id));
    const ids = userCommutes.map((c) => c.id);
    const settings = ids.length
      ? await db
          .select({
            commuteId: alertSettings.commuteId,
            enabled: alertSettings.enabled,
            types: alertSettings.types,
            delayThresholdMin: alertSettings.delayThresholdMin,
            quietStart: alertSettings.quietStart,
            quietEnd: alertSettings.quietEnd,
          })
          .from(alertSettings)
          .where(inArray(alertSettings.commuteId, ids))
      : [];
    const data = {
      exportedAt: now().toISOString(),
      profile,
      commutes: userCommutes.map(({ userId: _u, ...c }) => c),
      alertSettings: settings,
      journeys: (await db.select().from(journeys).where(eq(journeys.userId, id))).map(({ userId: _u, ...j }) => j),
      alertsSent: (await db.select().from(alertLog).where(eq(alertLog.userId, id))).map(({ userId: _u, dedupeKey: _d, ...a }) => a),
    };
    return reply
      .header('content-disposition', `attachment; filename="my-commuter-train-export-${now().toISOString().slice(0, 10)}.json"`)
      .send(data);
  });
}
