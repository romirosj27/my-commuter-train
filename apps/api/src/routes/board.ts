import { crsSchema, isoDateSchema, localTimeSchema, toLondon, tocSchema } from '@mct/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.ts';
import { notFound, parse } from '../lib/http.ts';
import { getBoard, getServiceDetail } from '../services/board.ts';

const boardQuery = z
  .object({
    from: crsSchema,
    to: crsSchema,
    date: isoDateSchema.optional(),
    start: localTimeSchema.default('00:00'),
    end: localTimeSchema.default('00:00'),
    operators: z
      .string()
      .optional()
      .transform((s) => (s ? s.split(',').filter(Boolean) : []))
      .pipe(z.array(tocSchema).max(20)),
  })
  .refine((q) => q.from !== q.to, { message: 'from and to must differ', path: ['to'] });

const idParams = z.object({ id: z.string().uuid() });
const detailQuery = z.object({ from: crsSchema.optional(), to: crsSchema.optional() });

export async function boardRoutes(app: FastifyInstance, { db, ref, now, predictions }: AppDeps) {
  /**
   * Services from one station to another within a London time window.
   * `end` <= `start` wraps past midnight; the default (00:00–00:00) is the whole day.
   */
  app.get('/api/board', async (req) => {
    const q = parse(boardQuery, req.query);
    const date = q.date ?? toLondon(now()).date;
    const services = await getBoard(db, ref, {
      fromCrs: q.from,
      toCrs: q.to,
      date,
      start: q.start,
      end: q.end,
      operators: q.operators,
    }, { inputs: predictions, now: now() });
    return { from: q.from, to: q.to, date, start: q.start, end: q.end, generatedAt: now().toISOString(), services };
  });

  app.get('/api/services/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const { from, to } = parse(detailQuery, req.query);
    const detail = await getServiceDetail(db, ref, id, { inputs: predictions, now: now(), fromCrs: from, toCrs: to });
    if (!detail) throw notFound('Service');
    return detail;
  });
}
