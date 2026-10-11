/**
 * Data-source adapter interfaces and the normalised domain types they emit.
 *
 * These types are OUR model, not any feed's wire format. Each real adapter
 * maps its feed's messages into these shapes inside its own isolated
 * `parse.ts`; nothing outside that module should know a feed's field names.
 *
 * All instants are ISO-8601 UTC strings so events can cross job queues as JSON.
 */
import type { Operator, Station, Tiploc } from './schemas/index.ts';

export type IsoInstant = string;

export interface FeedHealth {
  name: string;
  mode: 'mock' | 'live';
  connected: boolean;
  lastMessageAt: IsoInstant | null;
  reconnects: number;
  lastError: string | null;
}

export interface FeedConnection {
  readonly name: string;
  /** Runs until `signal` aborts. Live adapters reconnect with backoff internally. */
  start(signal: AbortSignal): Promise<void>;
  health(): FeedHealth;
}

// ---------------------------------------------------------------------------
// Darwin: schedules, forecasts, actuals, platforms, cancellations, associations
// ---------------------------------------------------------------------------

export interface NormalisedService {
  /** The feed's unique identifier for this run of the service. */
  feedId: string;
  /** Timetable UID. */
  uid: string;
  /** Service start date, London calendar date (YYYY-MM-DD). */
  ssd: string;
  toc: string;
  headcode: string | null;
  isPassenger: boolean;
}

/**
 * Identifies a call within a service. A TIPLOC can appear more than once in a
 * calling pattern (e.g. loops), so the scheduled time disambiguates.
 */
export interface CallRef {
  tiploc: string;
  /** Scheduled arrival or departure at that call, if needed to disambiguate. */
  sched?: IsoInstant;
}

export type CallActivity = 'origin' | 'stop' | 'pass' | 'destination';

export interface NormalisedCall {
  tiploc: string;
  crs: string | null;
  activity: CallActivity;
  /** Public (GBTT) times where they exist, else working times. */
  schedArr: IsoInstant | null;
  schedDep: IsoInstant | null;
  platformBooked: string | null;
}

export interface CallUpdate extends CallRef {
  fcstArr?: IsoInstant | null;
  fcstDep?: IsoInstant | null;
  actualArr?: IsoInstant | null;
  actualDep?: IsoInstant | null;
  platform?: string | null;
  platformConfirmed?: boolean;
  isCancelled?: boolean;
  /** Free-text reason for display; the feed's code-to-text lookup happens in parse.ts. */
  cancelReason?: string | null;
  delayReason?: string | null;
}

/**
 * Relationship between two services at a location.
 * 'forms' = the main service's unit goes on to form the associated service.
 * RAIL-DATA-CONFIRM: mapping from Darwin association categories to these values.
 */
export type AssociationKind = 'forms' | 'join' | 'divide';

export type DarwinEvent =
  | { kind: 'schedule'; at: IsoInstant; service: NormalisedService; calls: NormalisedCall[] }
  | { kind: 'update'; at: IsoInstant; feedId: string; calls: CallUpdate[] }
  | {
      kind: 'cancellation';
      at: IsoInstant;
      feedId: string;
      /** 'full' or the calls that are cancelled (part cancellation). */
      scope: 'full' | CallRef[];
      reason: string | null;
    }
  | { kind: 'reinstatement'; at: IsoInstant; feedId: string }
  | {
      kind: 'association';
      at: IsoInstant;
      mainFeedId: string;
      assocFeedId: string;
      association: AssociationKind;
      tiploc: string;
      deleted: boolean;
    };

export interface DarwinFeed extends FeedConnection {
  onEvent(handler: (e: DarwinEvent) => Promise<void>): void;
  /** State for the given stations between two instants, e.g. on startup or after a gap. */
  snapshot(crs: ReadonlyArray<string>, from: Date, to: Date): AsyncIterable<DarwinEvent>;
}

// ---------------------------------------------------------------------------
// Network Rail open data: TRUST movements, TD berth steps
// ---------------------------------------------------------------------------

export type NetworkEvent =
  | {
      kind: 'movement';
      at: IsoInstant;
      /** Feed's train identifier, mapped to a Darwin service where possible. */
      trainRef: string;
      feedId: string | null;
      tiploc: string;
      /** Minutes late (negative = early) as reported. */
      delayMin: number;
    }
  | { kind: 'cancellation'; at: IsoInstant; trainRef: string; feedId: string | null; tiploc: string | null; reason: string | null }
  | { kind: 'berth_step'; at: IsoInstant; area: string; from: string | null; to: string | null; description: string };

export interface NetworkRailFeed extends FeedConnection {
  onEvent(handler: (e: NetworkEvent) => Promise<void>): void;
}

// ---------------------------------------------------------------------------
// HSP: historical service performance
// ---------------------------------------------------------------------------

export interface HspQuery {
  fromCrs: string;
  toCrs: string;
  fromDate: string; // YYYY-MM-DD
  toDate: string;
  fromTime: string; // HH:MM London
  toTime: string;
  days: 'weekday' | 'saturday' | 'sunday';
  tocs?: string[];
}

export interface HspServiceSummary {
  serviceRef: string;
  toc: string;
  originCrs: string;
  destCrs: string;
  schedDepLocal: string; // HH:MM
  schedArrLocal: string;
}

export interface HspCall {
  crs: string;
  schedArr: IsoInstant | null;
  schedDep: IsoInstant | null;
  actualArr: IsoInstant | null;
  actualDep: IsoInstant | null;
  lateCancReason: string | null;
}

export interface HspServiceDetail {
  serviceRef: string;
  date: string;
  toc: string;
  calls: HspCall[];
}

export interface HspClient {
  readonly mode: 'mock' | 'live';
  serviceMetrics(q: HspQuery): Promise<HspServiceSummary[]>;
  serviceDetails(serviceRef: string): Promise<HspServiceDetail>;
}

// ---------------------------------------------------------------------------
// Published incidents
// ---------------------------------------------------------------------------

export interface Incident {
  feedId: string;
  summary: string;
  description: string;
  startsAt: IsoInstant;
  endsAt: IsoInstant | null;
  affectedCrs: string[];
  operatorCodes: string[];
  updatedAt: IsoInstant;
}

export interface IncidentsFeed {
  readonly mode: 'mock' | 'live';
  fetchActive(now: Date): Promise<Incident[]>;
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export interface ReferenceDataSource {
  readonly mode: 'mock' | 'live';
  stations(): AsyncIterable<Station>;
  tiplocs(): AsyncIterable<Tiploc>;
  operators(): AsyncIterable<Operator>;
}
