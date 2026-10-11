import {
  addDays,
  formatLondonHm,
  inLocalWindow,
  toLondon,
  type HspClient,
  type HspQuery,
  type HspServiceDetail,
  type HspServiceSummary,
} from '@mct/shared';
import type { ScenarioLibrary } from '../mock/library.ts';
import { reduce, type ServiceState } from '../mock/state.ts';

/**
 * Mock HSP: replays the scenarios for each past date in the query range and
 * reports their final (fully run) state as history.
 */
export class MockHspClient implements HspClient {
  readonly mode = 'mock' as const;

  constructor(private readonly library: ScenarioLibrary) {}

  private finalState(date: string): Map<string, ServiceState> {
    return reduce(this.library.forDate(date).flatMap((c) => c.darwin).sort((a, b) => a.at.localeCompare(b.at)));
  }

  async serviceMetrics(q: HspQuery): Promise<HspServiceSummary[]> {
    const out: HspServiceSummary[] = [];
    for (let d = q.fromDate; d <= q.toDate; d = addDays(d, 1)) {
      const weekday = toLondon(new Date(`${d}T12:00:00Z`)).weekday;
      const kind = weekday === 6 ? 'saturday' : weekday === 7 ? 'sunday' : 'weekday';
      if (kind !== q.days) continue;
      for (const s of this.finalState(d).values()) {
        if (q.tocs?.length && !q.tocs.includes(s.service.toc)) continue;
        const iFrom = s.calls.findIndex((c) => c.crs === q.fromCrs && c.schedDep);
        const iTo = s.calls.findIndex((c, i) => i > iFrom && c.crs === q.toCrs && c.schedArr);
        if (iFrom < 0 || iTo < 0) continue;
        const dep = formatLondonHm(new Date(s.calls[iFrom]!.schedDep!));
        if (!inLocalWindow(dep, q.fromTime, q.toTime)) continue;
        out.push({
          serviceRef: s.service.feedId,
          toc: s.service.toc,
          originCrs: q.fromCrs,
          destCrs: q.toCrs,
          schedDepLocal: dep,
          schedArrLocal: formatLondonHm(new Date(s.calls[iTo]!.schedArr!)),
        });
      }
    }
    return out;
  }

  async serviceDetails(serviceRef: string): Promise<HspServiceDetail> {
    const ssd = /^mock:(\d{4}-\d{2}-\d{2}):/.exec(serviceRef)?.[1];
    const s = ssd ? this.finalState(ssd).get(serviceRef) : undefined;
    if (!s) throw new Error(`Unknown mock HSP service ${serviceRef}`);
    return {
      serviceRef,
      date: s.service.ssd,
      toc: s.service.toc,
      calls: s.calls
        .filter((c) => c.crs && c.activity !== 'pass')
        .map((c) => ({
          crs: c.crs!,
          schedArr: c.schedArr,
          schedDep: c.schedDep,
          actualArr: c.isCancelled ? null : c.actualArr,
          actualDep: c.isCancelled ? null : c.actualDep,
          lateCancReason: c.cancelReason ?? c.delayReason,
        })),
    };
  }
}
