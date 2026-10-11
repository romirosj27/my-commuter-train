import { delayRepaySchemes, operators } from '@mct/db';
import { asc, eq } from '@mct/db/orm';
import { CHECK_TERMS_NOTE, crsSchema, delayRepayBandsSchema, isoDateSchema, localTimeSchema, toLondon, tocSchema } from '@mct/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.ts';
import { HttpError, notFound, parse } from '../lib/http.ts';
import { userOf } from '../plugins/auth.ts';
import { JourneyService } from '../services/journeys.ts';

const ticketType = z.enum(['single', 'return', 'season']);
const idParams = z.object({ id: z.string().uuid() });

const fromService = z
  .object({
    serviceId: z.string().uuid(),
    originCrs: crsSchema,
    destCrs: crsSchema,
    ticketType: ticketType.default('single'),
    commuteId: z.string().uuid().nullish(),
  })
  .strict();

const manual = z
  .object({
    travelDate: isoDateSchema,
    originCrs: crsSchema,
    destCrs: crsSchema,
    toc: tocSchema,
    schedDep: localTimeSchema,
    schedArr: localTimeSchema,
    actualArr: localTimeSchema.nullable().default(null),
    ticketType: ticketType.default('single'),
  })
  .strict()
  .refine((m) => m.originCrs !== m.destCrs, { message: 'Origin and destination must differ', path: ['destCrs'] });

const patch = z
  .object({
    actualArr: localTimeSchema.nullable().optional(),
    ticketType: ticketType.optional(),
    claimStatus: z.enum(['none', 'claimed', 'paid', 'rejected']).optional(),
  })
  .strict();

const listQuery = z.object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() });
const suggestQuery = z.object({ date: isoDateSchema.optional(), commute: z.string().uuid().optional() });

const schemeBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    bands: delayRepayBandsSchema,
    claimUrl: z.string().url().startsWith('https://').nullable(),
    notes: z.string().max(1000).nullable(),
    /** The date someone last checked these terms against the operator's own; null = unverified. */
    verifiedOn: isoDateSchema.nullable(),
  })
  .strict();

export async function journeyRoutes(app: FastifyInstance, deps: AppDeps & { adminEmails: Set<string> }) {
  const service = new JourneyService(deps.db, deps.ref);
  const auth = { preHandler: app.requireUser };
  const requireAdmin = async (req: Parameters<typeof app.requireUser>[0]) => {
    if (!deps.adminEmails.has(userOf(req).email.toLowerCase())) throw new HttpError(403, 'Admins only');
  };

  /** The user's own confirmed journeys, each with a Delay Repay assessment. */
  app.get('/api/journeys', auth, async (req) => {
    const q = parse(listQuery, req.query);
    return { journeys: await service.list(userOf(req).id, q.from, q.to), note: CHECK_TERMS_NOTE };
  });

  app.get('/api/journeys/suggestions', auth, async (req) => {
    const q = parse(suggestQuery, req.query);
    const date = q.date ?? toLondon(deps.now()).date;
    return { date, suggestions: await service.suggestions(userOf(req).id, date, q.commute) };
  });

  /** Log a journey: either confirm a train ({ serviceId, ... }) or enter one by hand. */
  app.post('/api/journeys', auth, async (req, reply) => {
    const body = req.body as Record<string, unknown> | undefined;
    const user = userOf(req).id;
    const created =
      body && 'serviceId' in body
        ? await service.createFromService(user, parse(fromService, body))
        : await service.createManual(user, parse(manual, body));
    return reply.code(201).send(created);
  });

  app.get('/api/journeys/:id', auth, async (req) => service.get(userOf(req).id, parse(idParams, req.params).id));

  app.patch('/api/journeys/:id', auth, async (req) =>
    service.update(userOf(req).id, parse(idParams, req.params).id, parse(patch, req.body)),
  );

  app.delete('/api/journeys/:id', auth, async (req, reply) => {
    await service.remove(userOf(req).id, parse(idParams, req.params).id);
    return reply.code(204).send();
  });

  /** Operator Delay Repay rules (read by everyone signed in). */
  app.get('/api/delay-repay/schemes', auth, async () => {
    const rows = await deps.db
      .select({ s: delayRepaySchemes, operator: operators.name })
      .from(delayRepaySchemes)
      .innerJoin(operators, eq(operators.code, delayRepaySchemes.toc))
      .orderBy(asc(operators.name));
    return {
      note: CHECK_TERMS_NOTE,
      schemes: rows.map(({ s, operator }) => ({
        toc: s.toc.trim(),
        operator,
        name: s.name,
        bands: s.bands,
        claimUrl: s.claimUrl,
        notes: s.notes,
        verifiedOn: s.verifiedOn,
        updatedAt: s.updatedAt.toISOString(),
      })),
    };
  });

  /** Edit an operator's rules (admins only, see ADMIN_EMAILS). */
  app.put('/api/delay-repay/schemes/:toc', { preHandler: [app.requireUser, requireAdmin] }, async (req) => {
    const { toc } = parse(z.object({ toc: tocSchema }), req.params);
    const body = parse(schemeBody, req.body);
    const [op] = await deps.db.select({ code: operators.code }).from(operators).where(eq(operators.code, toc));
    if (!op) throw notFound('Operator');
    await deps.db
      .insert(delayRepaySchemes)
      .values({ toc, ...body })
      .onConflictDoUpdate({ target: delayRepaySchemes.toc, set: { ...body, updatedAt: new Date() } });
    req.log.info({ toc, by: userOf(req).id }, 'delay repay scheme updated');
    return { toc, ...body };
  });
}
