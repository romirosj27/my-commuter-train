/**
 * In-memory reducer over normalised Darwin events. The mock adapters use it to
 * answer snapshot and HSP queries; it is not the persistence path (that is the
 * ingest pipeline).
 */
import type { CallRef, DarwinEvent, NormalisedCall, NormalisedService } from '@mct/shared';

export interface CallState extends NormalisedCall {
  fcstArr: string | null;
  fcstDep: string | null;
  actualArr: string | null;
  actualDep: string | null;
  platform: string | null;
  platformConfirmed: boolean;
  isCancelled: boolean;
  cancelReason: string | null;
  delayReason: string | null;
}

export interface ServiceState {
  service: NormalisedService;
  calls: CallState[];
  isCancelled: boolean;
  cancelReason: string | null;
  associations: Array<{ assocFeedId: string; association: string; tiploc: string }>;
}

export function findCall(calls: CallState[], ref: CallRef): CallState | undefined {
  return calls.find(
    (c) => c.tiploc === ref.tiploc && (ref.sched === undefined || c.schedDep === ref.sched || c.schedArr === ref.sched),
  );
}

export function applyDarwinEvent(state: Map<string, ServiceState>, e: DarwinEvent): void {
  switch (e.kind) {
    case 'schedule': {
      state.set(e.service.feedId, {
        service: e.service,
        calls: e.calls.map((c) => ({
          ...c,
          fcstArr: null,
          fcstDep: null,
          actualArr: null,
          actualDep: null,
          platform: c.platformBooked,
          platformConfirmed: false,
          isCancelled: false,
          cancelReason: null,
          delayReason: null,
        })),
        isCancelled: false,
        cancelReason: null,
        associations: state.get(e.service.feedId)?.associations ?? [],
      });
      return;
    }
    case 'update': {
      const s = state.get(e.feedId);
      if (!s) return;
      for (const u of e.calls) {
        const call = findCall(s.calls, u);
        if (!call) continue;
        const { tiploc: _t, sched: _s, ...fields } = u;
        for (const [k, v] of Object.entries(fields)) {
          if (v !== undefined) (call as unknown as Record<string, unknown>)[k] = v;
        }
      }
      return;
    }
    case 'cancellation': {
      const s = state.get(e.feedId);
      if (!s) return;
      if (e.scope === 'full') {
        s.isCancelled = true;
        s.cancelReason = e.reason;
        for (const c of s.calls) {
          c.isCancelled = true;
          c.cancelReason = e.reason;
        }
      } else {
        for (const ref of e.scope) {
          const call = findCall(s.calls, ref);
          if (call) {
            call.isCancelled = true;
            call.cancelReason = e.reason;
          }
        }
      }
      return;
    }
    case 'reinstatement': {
      const s = state.get(e.feedId);
      if (!s) return;
      s.isCancelled = false;
      s.cancelReason = null;
      for (const c of s.calls) {
        c.isCancelled = false;
        c.cancelReason = null;
      }
      return;
    }
    case 'association': {
      const s = state.get(e.mainFeedId);
      if (!s) return;
      s.associations = s.associations.filter(
        (a) => !(a.assocFeedId === e.assocFeedId && a.association === e.association),
      );
      if (!e.deleted) s.associations.push({ assocFeedId: e.assocFeedId, association: e.association, tiploc: e.tiploc });
      return;
    }
  }
}

export function reduce(events: Iterable<DarwinEvent>): Map<string, ServiceState> {
  const state = new Map<string, ServiceState>();
  for (const e of events) applyDarwinEvent(state, e);
  return state;
}
