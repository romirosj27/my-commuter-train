import { upsertReferenceData, type Db } from '@mct/db';
import type { Operator, ReferenceDataSource, Station, Tiploc } from '@mct/shared';

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

export async function refreshReferenceData(db: Db, source: ReferenceDataSource): Promise<{ stations: number; tiplocs: number; operators: number }> {
  const [stations, tiplocs, operators]: [Station[], Tiploc[], Operator[]] = await Promise.all([
    collect(source.stations()),
    collect(source.tiplocs()),
    collect(source.operators()),
  ]);
  await upsertReferenceData(db, { stations, tiplocs, operators });
  return { stations: stations.length, tiplocs: tiplocs.length, operators: operators.length };
}
