import { operators, stations } from '@mct/db';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.ts';
import { parse } from '../lib/http.ts';

const stationQuery = z.object({ q: z.string().trim().min(1).max(60) });

export async function referenceRoutes(app: FastifyInstance, { db }: AppDeps) {
  /** Autocomplete on station name or CRS code. */
  app.get('/api/stations', async (req) => {
    const { q } = parse(stationQuery, req.query);
    const term = q
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .trim();
    const code = q.toUpperCase();
    const like = term.replace(/[%_\\]/g, '\\$&');
    const rows = await db
      .select({ crs: stations.crs, name: stations.name })
      .from(stations)
      .where(
        sql`${stations.crs} = ${code}
          or ${stations.searchName} like ${like + '%'}
          or ${stations.searchName} like ${'% ' + like + '%'}
          or (length(${term}) >= 3 and ${stations.searchName} % ${term})`,
      )
      .orderBy(
        sql`(${stations.crs} = ${code}) desc`,
        sql`(${stations.searchName} like ${like + '%'}) desc`,
        sql`similarity(${stations.searchName}, ${term}) desc`,
        asc(stations.name),
      )
      .limit(10);
    return { stations: rows.map((r) => ({ crs: r.crs.trim(), name: r.name })) };
  });

  app.get('/api/operators', async () => {
    const rows = await db
      .select({ code: operators.code, name: operators.name })
      .from(operators)
      .where(eq(operators.active, true))
      .orderBy(asc(operators.name));
    return { operators: rows.map((r) => ({ code: r.code.trim(), name: r.name })) };
  });
}
