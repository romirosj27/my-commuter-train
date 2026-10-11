/**
 * Database schema. Instants are `timestamptz` (UTC); London wall-clock values
 * (commute windows, quiet hours) are `time` and are interpreted in
 * Europe/London when evaluated. Service start dates are London calendar dates.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  pgView,
  primaryKey,
  real,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------
// Auth: shape required by Better Auth's Drizzle adapter (camelCase fields are
// mapped by Better Auth; column names here are snake_case).
// ---------------------------------------------------------------------------

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  timezone: text('timezone').notNull().default('Europe/London'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: ts('expires_at').notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('account_user_idx').on(t.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export const stations = pgTable(
  'stations',
  {
    crs: char('crs', { length: 3 }).primaryKey(),
    name: text('name').notNull(),
    /** Lower-cased, accent-stripped name for autocomplete. */
    searchName: text('search_name').notNull(),
    lat: real('lat'),
    lon: real('lon'),
    updatedAt: updatedAt(),
  },
  (t) => [index('stations_search_trgm_idx').using('gin', sql`${t.searchName} gin_trgm_ops`)],
);

export const tiplocs = pgTable(
  'tiplocs',
  {
    tiploc: varchar('tiploc', { length: 7 }).primaryKey(),
    crs: char('crs', { length: 3 }).references(() => stations.crs, { onDelete: 'set null' }),
    name: text('name').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [index('tiplocs_crs_idx').on(t.crs)],
);

export const operators = pgTable('operators', {
  code: char('code', { length: 2 }).primaryKey(),
  name: text('name').notNull(),
  claimUrl: text('claim_url'),
  active: boolean('active').notNull().default(true),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Commutes and alert settings
// ---------------------------------------------------------------------------

export const commutes = pgTable(
  'commutes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    homeCrs: char('home_crs', { length: 3 })
      .notNull()
      .references(() => stations.crs),
    workCrs: char('work_crs', { length: 3 })
      .notNull()
      .references(() => stations.crs),
    /** London wall-clock; end < start means the window wraps midnight. */
    outboundStart: time('outbound_start').notNull(),
    outboundEnd: time('outbound_end').notNull(),
    returnStart: time('return_start').notNull(),
    returnEnd: time('return_end').notNull(),
    /** ISO weekday bitmask: Monday = bit 0 … Sunday = bit 6. */
    activeDays: smallint('active_days').notNull(),
    /** Empty array = all operators. */
    operatorCodes: text('operator_codes').array().notNull().default(sql`'{}'::text[]`),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('commutes_user_idx').on(t.userId),
    uniqueIndex('commutes_one_default_per_user').on(t.userId).where(sql`${t.isDefault}`),
    check('commutes_distinct_stations', sql`${t.homeCrs} <> ${t.workCrs}`),
    check('commutes_active_days_range', sql`${t.activeDays} between 1 and 127`),
  ],
);

export const alertTypeEnum = pgEnum('alert_type', [
  'platform_change',
  'cancellation',
  'delay',
  'predicted_disruption',
]);

export const alertSettings = pgTable(
  'alert_settings',
  {
    commuteId: uuid('commute_id')
      .primaryKey()
      .references(() => commutes.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    types: alertTypeEnum('types')
      .array()
      .notNull()
      .default(sql`'{platform_change,cancellation,delay,predicted_disruption}'::alert_type[]`),
    delayThresholdMin: integer('delay_threshold_min').notNull().default(5),
    /** London wall-clock; both null = no quiet hours. */
    quietStart: time('quiet_start'),
    quietEnd: time('quiet_end'),
    unsubscribeToken: text('unsubscribe_token').notNull().unique(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('alert_settings_threshold_range', sql`${t.delayThresholdMin} between 1 and 240`),
    check('alert_settings_quiet_both_or_neither', sql`(${t.quietStart} is null) = (${t.quietEnd} is null)`),
  ],
);

/** Stations that appear in at least one commute; the worker only persists services calling at these. */
export const watchedCrs = pgView('watched_crs').as((qb) =>
  qb
    .selectDistinct({ crs: sql<string>`crs`.as('crs') })
    .from(sql`(select home_crs as crs from commutes union select work_crs from commutes) as w`),
);

// ---------------------------------------------------------------------------
// Live services
// ---------------------------------------------------------------------------

export const services = pgTable(
  'services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Feed's unique identifier for this run of the service. */
    feedId: text('feed_id').notNull().unique(),
    uid: text('uid').notNull(),
    /** Service start date (London calendar date). */
    ssd: date('ssd', { mode: 'string' }).notNull(),
    toc: char('toc', { length: 2 }).notNull(),
    headcode: text('headcode'),
    originTiploc: varchar('origin_tiploc', { length: 7 }),
    destTiploc: varchar('dest_tiploc', { length: 7 }),
    isCancelled: boolean('is_cancelled').notNull().default(false),
    cancelReason: text('cancel_reason'),
    delayReason: text('delay_reason'),
    lastFeedAt: ts('last_feed_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('services_ssd_idx').on(t.ssd), index('services_uid_ssd_idx').on(t.uid, t.ssd)],
);

export const callActivityEnum = pgEnum('call_activity', ['origin', 'stop', 'pass', 'destination']);

export const serviceCalls = pgTable(
  'service_calls',
  {
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    seq: smallint('seq').notNull(),
    tiploc: varchar('tiploc', { length: 7 }).notNull(),
    crs: char('crs', { length: 3 }),
    activity: callActivityEnum('activity').notNull(),
    isPublic: boolean('is_public').notNull(),
    schedArr: ts('sched_arr'),
    schedDep: ts('sched_dep'),
    fcstArr: ts('fcst_arr'),
    fcstDep: ts('fcst_dep'),
    actualArr: ts('actual_arr'),
    actualDep: ts('actual_dep'),
    platform: text('platform'),
    platformBooked: text('platform_booked'),
    platformConfirmed: boolean('platform_confirmed').notNull().default(false),
    isCancelled: boolean('is_cancelled').notNull().default(false),
    cancelReason: text('cancel_reason'),
    delayReason: text('delay_reason'),
  },
  (t) => [
    primaryKey({ columns: [t.serviceId, t.seq] }),
    index('service_calls_crs_dep_idx').on(t.crs, t.schedDep),
    index('service_calls_crs_arr_idx').on(t.crs, t.schedArr),
  ],
);

export const associationKindEnum = pgEnum('association_kind', ['forms', 'join', 'divide']);

export const associations = pgTable(
  'associations',
  {
    mainServiceId: uuid('main_service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    assocServiceId: uuid('assoc_service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    kind: associationKindEnum('kind').notNull(),
    tiploc: varchar('tiploc', { length: 7 }).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.mainServiceId, t.assocServiceId, t.kind] }),
    index('associations_assoc_idx').on(t.assocServiceId),
  ],
);

export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    feedId: text('feed_id').notNull().unique(),
    summary: text('summary').notNull(),
    description: text('description').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at'),
    affectedCrs: text('affected_crs').array().notNull().default(sql`'{}'::text[]`),
    operatorCodes: text('operator_codes').array().notNull().default(sql`'{}'::text[]`),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [index('incidents_affected_crs_idx').using('gin', t.affectedCrs)],
);

export const networkEventKindEnum = pgEnum('network_event_kind', ['movement', 'cancellation', 'berth_step']);

/** Rolling buffer of network-wide events (purged after a few hours). */
export const networkEvents = pgTable(
  'network_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: networkEventKindEnum('kind').notNull(),
    trainRef: text('train_ref'),
    serviceFeedId: text('service_feed_id'),
    tiploc: varchar('tiploc', { length: 7 }),
    crs: char('crs', { length: 3 }),
    delayMin: integer('delay_min'),
    reason: text('reason'),
    observedAt: ts('observed_at').notNull(),
  },
  (t) => [index('network_events_crs_time_idx').on(t.crs, t.observedAt), index('network_events_time_idx').on(t.observedAt)],
);

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export const alertLog = pgTable(
  'alert_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    commuteId: uuid('commute_id').references(() => commutes.id, { onDelete: 'set null' }),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
    type: alertTypeEnum('type').notNull(),
    /** Normalised value, e.g. `plat:4`, `delay:15`, `risk:high`. */
    value: text('value').notNull(),
    /** Hash of (user, service, type, value bucket); unique so a change sends once. */
    dedupeKey: text('dedupe_key').notNull().unique(),
    emailMessageId: text('email_message_id'),
    sentAt: ts('sent_at').notNull().defaultNow(),
  },
  (t) => [index('alert_log_user_time_idx').on(t.userId, t.sentAt)],
);

// ---------------------------------------------------------------------------
// Delay Repay
// ---------------------------------------------------------------------------

export interface DelayRepayBand {
  minMinutes: number;
  /** Exclusive upper bound; null = open-ended. */
  maxMinutes: number | null;
  singlePct: number;
  returnPct: number;
}

export const delayRepaySchemes = pgTable('delay_repay_schemes', {
  id: uuid('id').primaryKey().defaultRandom(),
  toc: char('toc', { length: 2 })
    .notNull()
    .unique()
    .references(() => operators.code),
  name: text('name').notNull(),
  bands: jsonb('bands').$type<DelayRepayBand[]>().notNull(),
  claimUrl: text('claim_url'),
  notes: text('notes'),
  /** When someone last checked these terms against the operator's site; null = unverified placeholder. */
  verifiedOn: date('verified_on', { mode: 'string' }),
  updatedAt: updatedAt(),
});

export const journeyStatusEnum = pgEnum('journey_status', ['suggested', 'confirmed', 'dismissed']);
export const ticketTypeEnum = pgEnum('ticket_type', ['single', 'return', 'season']);
export const claimStatusEnum = pgEnum('claim_status', ['none', 'claimed', 'paid', 'rejected']);
export const journeySourceEnum = pgEnum('journey_source', ['live', 'hsp', 'manual']);

export const journeys = pgTable(
  'journeys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    commuteId: uuid('commute_id').references(() => commutes.id, { onDelete: 'set null' }),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
    travelDate: date('travel_date', { mode: 'string' }).notNull(),
    originCrs: char('origin_crs', { length: 3 }).notNull(),
    destCrs: char('dest_crs', { length: 3 }).notNull(),
    toc: char('toc', { length: 2 }).notNull(),
    schedDep: ts('sched_dep').notNull(),
    schedArr: ts('sched_arr').notNull(),
    actualArr: ts('actual_arr'),
    /** Arrival delay at destination in whole minutes; null until known. */
    arrivalDelayMin: integer('arrival_delay_min'),
    destCancelled: boolean('dest_cancelled').notNull().default(false),
    status: journeyStatusEnum('status').notNull().default('suggested'),
    ticketType: ticketTypeEnum('ticket_type').notNull().default('single'),
    claimStatus: claimStatusEnum('claim_status').notNull().default('none'),
    source: journeySourceEnum('source').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('journeys_user_date_idx').on(t.userId, t.travelDate),
    uniqueIndex('journeys_user_service_uniq').on(t.userId, t.serviceId).where(sql`${t.serviceId} is not null`),
  ],
);
