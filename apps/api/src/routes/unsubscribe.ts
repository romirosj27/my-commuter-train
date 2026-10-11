import { alertSettings, commutes } from '@mct/db';
import { eq } from '@mct/db/orm';
import { escapeHtml, layout } from '@mct/email';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.ts';

const tokenQuery = z.object({ token: z.string().min(16).max(128) });

/**
 * One-click unsubscribe from a commute's alert emails.
 * GET shows a confirmation page (so link scanners can't unsubscribe anyone);
 * POST performs it, and is also the RFC 8058 List-Unsubscribe-Post target.
 */
export async function unsubscribeRoutes(app: FastifyInstance, { db, webURL }: AppDeps & { webURL: string }) {
  // RFC 8058 one-click posts are form-encoded; the body itself isn't needed.
  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, body));
  }

  const findCommute = async (token: string) => {
    const [row] = await db
      .select({ commuteId: alertSettings.commuteId, enabled: alertSettings.enabled, name: commutes.name })
      .from(alertSettings)
      .innerJoin(commutes, eq(commutes.id, alertSettings.commuteId))
      .where(eq(alertSettings.unsubscribeToken, token));
    return row;
  };

  const page = (title: string, body: string) =>
    layout({ title, bodyHtml: `<h1 style="font-size:20px;margin:0 0 12px;">${escapeHtml(title)}</h1>${body}` });

  app.get('/api/unsubscribe', async (req, reply) => {
    const parsed = tokenQuery.safeParse(req.query);
    const row = parsed.success ? await findCommute(parsed.data.token) : undefined;
    reply.type('text/html; charset=utf-8');
    if (!row) return reply.code(404).send(page('Link not recognised', '<p>This unsubscribe link is invalid or has expired.</p>'));
    const settings = `${webURL}/commutes/${row.commuteId}`;
    if (!row.enabled) {
      return page('Already unsubscribed', `<p>You don't get alert emails for “${escapeHtml(row.name)}”.</p><p><a href="${escapeHtml(settings)}">Alert settings</a></p>`);
    }
    return page(
      'Stop alert emails?',
      `<p>Stop email alerts for your commute “${escapeHtml(row.name)}”?</p>
<form method="post"><button type="submit" style="background:#1d4ed8;color:#fff;border:0;padding:10px 16px;border-radius:6px;font-weight:600;font-size:16px;">Unsubscribe</button></form>
<p style="font-size:13px;color:#555;">You can turn them back on any time in <a href="${escapeHtml(settings)}">alert settings</a>.</p>`,
    );
  });

  app.post('/api/unsubscribe', async (req, reply) => {
    const parsed = tokenQuery.safeParse(req.query);
    const row = parsed.success ? await findCommute(parsed.data.token) : undefined;
    reply.type('text/html; charset=utf-8');
    if (!row) return reply.code(404).send(page('Link not recognised', '<p>This unsubscribe link is invalid or has expired.</p>'));
    await db.update(alertSettings).set({ enabled: false }).where(eq(alertSettings.commuteId, row.commuteId));
    req.log.info({ commuteId: row.commuteId }, 'unsubscribed from alerts');
    return page(
      'You’re unsubscribed',
      `<p>You won't get alert emails for “${escapeHtml(row.name)}” any more.</p><p><a href="${escapeHtml(`${webURL}/commutes/${row.commuteId}`)}">Turn them back on</a></p>`,
    );
  });
}
