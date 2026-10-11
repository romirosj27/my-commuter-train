import { alertSettingsSchema, commuteInputSchema, commutePatchSchema, isoDateSchema, toLondon, maskHasDay, weekdayMask } from '@mct/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.ts';
import { parse } from '../lib/http.ts';
import { userOf } from '../plugins/auth.ts';
import { getBoard } from '../services/board.ts';
import { CommuteService } from '../services/commutes.ts';

const idParams = z.object({ id: z.string().uuid() });
const boardQuery = z.object({
  direction: z.enum(['outbound', 'return']).default('outbound'),
  date: isoDateSchema.optional(),
});

export async function commuteRoutes(app: FastifyInstance, deps: AppDeps) {
  const service = new CommuteService(deps.db, deps.ref);
  const auth = { preHandler: app.requireUser };

  app.get('/api/commutes', auth, async (req) => ({ commutes: await service.list(userOf(req).id) }));

  app.post('/api/commutes', auth, async (req, reply) => {
    const input = parse(commuteInputSchema, req.body);
    return reply.code(201).send(await service.create(userOf(req).id, input));
  });

  app.get('/api/commutes/:id', auth, async (req) => {
    const { id } = parse(idParams, req.params);
    return service.get(userOf(req).id, id);
  });

  app.patch('/api/commutes/:id', auth, async (req) => {
    const { id } = parse(idParams, req.params);
    return service.update(userOf(req).id, id, parse(commutePatchSchema, req.body));
  });

  app.delete('/api/commutes/:id', auth, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    await service.remove(userOf(req).id, id);
    return reply.code(204).send();
  });

  app.post('/api/commutes/:id/default', auth, async (req) => {
    const { id } = parse(idParams, req.params);
    return service.setDefault(userOf(req).id, id);
  });

  app.get('/api/commutes/:id/alert-settings', auth, async (req) => {
    const { id } = parse(idParams, req.params);
    return (await service.get(userOf(req).id, id)).alertSettings;
  });

  app.put('/api/commutes/:id/alert-settings', auth, async (req) => {
    const { id } = parse(idParams, req.params);
    const settings = parse(alertSettingsSchema, req.body);
    return (await service.updateAlertSettings(userOf(req).id, id, settings)).alertSettings;
  });

  /** The commute's board: home → work in the outbound window, or work → home in the return window. */
  app.get('/api/commutes/:id/board', auth, async (req) => {
    const { id } = parse(idParams, req.params);
    const q = parse(boardQuery, req.query);
    const c = await service.get(userOf(req).id, id);
    const date = q.date ?? toLondon(deps.now()).date;
    const outbound = q.direction === 'outbound';
    const window = outbound ? c.outbound : c.return;
    const services = await getBoard(deps.db, deps.ref, {
      fromCrs: outbound ? c.homeCrs : c.workCrs,
      toCrs: outbound ? c.workCrs : c.homeCrs,
      date,
      start: window.start,
      end: window.end,
      operators: c.operatorCodes,
    });
    const weekday = toLondon(new Date(`${date}T12:00:00Z`)).weekday;
    return {
      commuteId: c.id,
      direction: q.direction,
      date,
      window,
      activeDay: maskHasDay(weekdayMask(c.activeDays as Parameters<typeof weekdayMask>[0]), weekday),
      generatedAt: deps.now().toISOString(),
      services,
    };
  });
}
