# UK rail commute tracker — MVP plan

Status: **awaiting approval**. Nothing below is built yet.

Conventions used throughout:

- All instants are `timestamptz` stored in UTC. Wall-clock fields that are
  inherently local (a commute window such as 07:00–09:00, quiet hours) are
  stored as `time` and are interpreted in `Europe/London` at evaluation time.
- A service's **service start date** (SSD) is kept as a local `date`, and
  every scheduled, forecast or actual time is resolved to a UTC instant from
  SSD + local time + day offset. This handles services that cross midnight and
  the BST/GMT change. The resolution lives in one function,
  `packages/shared/src/time`, and it is unit-tested.
- Feed-specific field names, message shapes, endpoints and auth flows are
  **placeholders** (marked `// FEED-SCHEMA-PLACEHOLDER`) until you supply the
  official docs. Each feed's parsing is isolated in
  `apps/worker/src/feeds/<feed>/parse.ts`.

---

## 1. Folder structure

```
.
├── apps/
│   ├── web/                 Vite + React + TanStack Router/Query/Table, shadcn/ui, Tailwind v4
│   │   └── src/{routes,components,features/{board,commutes,alerts,journeys,account},lib}
│   ├── api/                 Fastify + zod + Better Auth
│   │   └── src/{routes,plugins,services,auth,email}
│   │       └── test/        integration tests (real Postgres via docker-compose)
│   └── worker/              ingest + alert engine (BullMQ)
│       └── src/
│           ├── feeds/
│           │   ├── darwin/      adapter.ts (real) | mock.ts | parse.ts
│           │   ├── network-rail/ (TRUST + TD)
│           │   ├── hsp/
│           │   ├── incidents/
│           │   └── reference/
│           ├── ingest/          normalise → filter to watched stations → upsert
│           ├── alerts/          evaluate → dedupe → enqueue email
│           ├── jobs/            BullMQ queue + processor definitions
│           └── health.ts
├── packages/
│   ├── shared/              types, zod schemas, time utils, prediction rules, delay calc
│   │   └── src/{schemas,time,prediction,delay-repay,reference}
│   ├── db/                  Drizzle schema, migrations, client, seed
│   └── email/               EmailTransport interface, Resend + console transports, templates
├── fixtures/                mock feed scenarios (JSON, replayed by the mock adapters)
├── infra/                   Dockerfiles, fly.toml / railway.json, Cloudflare Pages config
├── docker-compose.yml       postgres:16, redis:7 (plus a mailpit option for dev email)
├── .env.example
└── pnpm-workspace.yaml
```

I've split `packages/db` and `packages/email` out of `shared`, so the web
bundle never pulls in Drizzle or Resend. `shared` stays isomorphic.

**Existing code:** the current repo is a Next.js + MongoDB + RTT prototype. My
proposal is to move it to `legacy/` in the Phase 1 commit, keep it for
reference, and delete it at Phase 8. See the questions at the end.

---

## 2. Database schema (Drizzle / Postgres)

### Auth (owned by Better Auth's Drizzle adapter)
`user`, `session`, `account`, `verification`. These use Better Auth's standard
columns, plus `user.timezone` (default `Europe/London`) for later use.

### Reference data
| table | columns | notes |
|---|---|---|
| `stations` | `crs` char(3) PK, `name`, `search_name` (lower, unaccented), `lat`, `lon` | trigram index on `search_name` for autocomplete |
| `tiplocs` | `tiploc` varchar(7) PK, `crs` FK→stations nullable, `name` | many TIPLOCs to one CRS; non-station TIPLOCs have a null CRS |
| `operators` | `code` char(2) PK, `name`, `claim_url`, `active` | |

### Commutes and alert settings
| table | columns |
|---|---|
| `commutes` | `id` uuid PK, `user_id` FK cascade, `name`, `home_crs`, `work_crs`, `outbound_start` time, `outbound_end` time, `return_start` time, `return_end` time, `active_days` smallint (ISO weekday bitmask, Mon=bit0), `operator_codes` char(2)[] (empty = all), `is_default` bool, timestamps |
| `alert_settings` | `commute_id` PK FK cascade, `enabled` bool, `types` text[] ⊆ {`platform_change`,`cancellation`,`delay`,`predicted_disruption`}, `delay_threshold_min` int, `quiet_start` time null, `quiet_end` time null (a window may wrap midnight), `unsubscribe_token` text unique |

Constraints: a partial unique index `(user_id) WHERE is_default` gives at
most one default per user. `home_crs <> work_crs`. A window may wrap midnight
(end < start), for example a night-shift return.

`watched_crs` is a **view**: the distinct `home_crs ∪ work_crs` across all
commutes. The worker reads it, through a short-lived cache, to decide which
services to persist.

### Live services
| table | columns |
|---|---|
| `services` | `id` uuid PK, `feed_id` text UNIQUE (Darwin's per-run identifier), `uid` text, `ssd` date, `toc` char(2), `headcode` text, `origin_tiploc`, `dest_tiploc`, `is_cancelled` bool, `cancel_reason` text, `delay_reason` text, `last_feed_at` timestamptz, `updated_at` |
| `service_calls` | PK (`service_id`, `seq`), `tiploc`, `crs` null, `activity` text, `is_public` bool (false for passing points), `sched_arr`/`sched_dep` timestamptz (public times, else working times), `fcst_arr`/`fcst_dep`, `actual_arr`/`actual_dep`, `platform`, `platform_booked`, `platform_confirmed` bool, `is_cancelled` bool, `cancel_reason`, `delay_reason` |
| `associations` | PK (`main_service_id`, `assoc_service_id`, `category`), `tiploc`. The forming-train relationship is the "next working" category; the exact category codes come from the Darwin docs |
| `incidents` | `id` uuid, `feed_id` unique, `summary`, `description`, `starts_at`, `ends_at` null, `affected_crs` char(3)[], `operator_codes` char(2)[], `updated_at` |
| `network_events` | `id`, `kind` (`cancellation` \| `delay` \| `berth_step`), `train_ref`, `tiploc`, `crs`, `delay_min`, `observed_at`. A rolling buffer from TRUST/TD, purged after 6h, used by the upstream-disruption rule |

Indexes: `service_calls (crs, sched_dep)` and `(crs, sched_arr)` for the
board query; `services (ssd)` for purging. Services older than SSD − 2 days
are purged nightly, after any journey that references them has been snapshotted.

### Alerts
| table | columns |
|---|---|
| `alert_log` | `id`, `user_id` FK cascade, `commute_id`, `service_id` null, `type`, `value` text (normalised, e.g. `plat:4`, `delay:15`, `risk:high`), `dedupe_key` text UNIQUE = hash(user, service, type, value bucket), `email_message_id`, `sent_at` |

"Materially changed" works like this. Delay values are bucketed: a follow-up
email goes only when the delay moves by at least `materialDelta` minutes
(default 5, configurable) or crosses back under the threshold, which sends one
"back to time" email. A change of platform or risk level always counts as
material.

### Delay Repay
| table | columns |
|---|---|
| `delay_repay_schemes` | `id`, `toc` char(2), `name`, `bands` jsonb `[{minMinutes, maxMinutes?, singlePct, returnPct}]`, `claim_url`, `notes`, `verified_on` date null, `updated_at` |
| `journeys` | `id`, `user_id` FK cascade, `commute_id` null, `service_id` null (set null on purge), `travel_date` date, `origin_crs`, `dest_crs`, `toc`, `sched_dep`, `sched_arr`, `actual_arr` null, `arrival_delay_min` null, `status` (`suggested` \| `confirmed` \| `dismissed`), `ticket_type` (`single` \| `return` \| `season`), `claim_status` (`none` \| `claimed` \| `paid` \| `rejected`), `source` (`live` \| `hsp` \| `manual`), timestamps |

Journeys keep their own copy of the times, so they survive the service purge.
Only rows the user has confirmed are assessed for eligibility.

---

## 3. API routes (Fastify, all zod-validated, prefix `/api`)

| method | path | notes |
|---|---|---|
| * | `/api/auth/*` | Better Auth: sign-up, verify email, sign-in/out, password reset. Stricter rate limit |
| GET | `/health` | DB + Redis ping |
| GET | `/api/stations?q=` | autocomplete on name or CRS, top 10 |
| GET | `/api/operators` | |
| GET, POST | `/api/commutes` | |
| GET, PATCH, DELETE | `/api/commutes/:id` | |
| POST | `/api/commutes/:id/default` | |
| GET, PUT | `/api/commutes/:id/alert-settings` | |
| GET | `/api/commutes/:id/board?direction=out\|ret&date=` | filtered to window, days and operators, with a risk badge per service |
| GET | `/api/services/:id` | full calling pattern, forming service, prediction breakdown |
| GET | `/api/journeys?from=&to=` | |
| POST | `/api/journeys` | manual entry |
| PATCH, DELETE | `/api/journeys/:id` | confirm, edit, dismiss, claim status |
| POST | `/api/journeys/suggest?date=` | builds suggested entries from the default commute's usual train |
| GET | `/api/journeys/:id/eligibility` | band, percentage, claim link and a "check the operator's current terms" note |
| GET | `/api/delay-repay/schemes` | read-only to users. Editing is through the seed/config file or an admin flag (see questions) |
| GET | `/api/me/export` | JSON download of all personal data |
| DELETE | `/api/me` | deletes the user; cascades remove everything personal |
| GET, POST | `/api/unsubscribe?token=` | one-click unsubscribe. POST supports `List-Unsubscribe-Post` (RFC 8058) |

Rate limits use `@fastify/rate-limit` backed by Redis: global per-IP, plus
tighter buckets on `/api/auth/*`.

---

## 4. Adapter interfaces (`packages/shared/src/feeds.ts`)

The interfaces carry **normalised domain types only**. Raw feed shapes never
leave `parse.ts`.

```ts
export interface FeedConnection {
  start(signal: AbortSignal): Promise<void>; // reconnects with backoff internally
  health(): FeedHealth;                        // { connected, lastMessageAt, reconnects }
}

export interface DarwinFeed extends FeedConnection {
  /** Live updates: schedules, forecasts, actuals, platforms, cancellations, associations. */
  onEvent(handler: (e: DarwinEvent) => Promise<void>): void;
  /** Snapshot/backfill for the given locations, e.g. on startup or after a gap. */
  snapshot(crs: string[], from: Date, to: Date): AsyncIterable<DarwinEvent>;
}
export type DarwinEvent =
  | { kind: 'schedule'; service: NormalisedService; calls: NormalisedCall[] }
  | { kind: 'forecast'; feedId: string; calls: Partial<NormalisedCall>[] }
  | { kind: 'cancellation'; feedId: string; scope: 'full' | { tiplocs: string[] }; reason?: string }
  | { kind: 'association'; main: string; assoc: string; category: AssociationCategory; tiploc: string };

export interface NetworkRailFeed extends FeedConnection {
  onMovement(handler: (e: NetworkEvent) => Promise<void>): void; // TRUST
  onBerthStep(handler: (e: NetworkEvent) => Promise<void>): void; // TD, optional for MVP
}

export interface HspClient {
  serviceMetrics(q: { fromCrs: string; toCrs: string; fromDate: string; toDate: string;
                      fromTime: string; toTime: string; days: 'WEEKDAY'|'SATURDAY'|'SUNDAY'; tocs?: string[] })
    : Promise<HspServiceSummary[]>;
  serviceDetails(serviceRef: string): Promise<HspServiceDetail>;
}

export interface IncidentsFeed {
  fetchActive(): Promise<Incident[]>;
}

export interface ReferenceDataSource {
  stations(): AsyncIterable<Station>;
  tiplocs(): AsyncIterable<{ tiploc: string; crs: string | null; name: string }>;
  operators(): AsyncIterable<Operator>;
}

export interface EmailTransport {
  send(m: { to: string; subject: string; text: string; html: string;
            headers?: Record<string,string> }): Promise<{ id: string }>;
}
```

The `HspClient` query fields above show intent only. The real parameter names
come from the HSP docs.

`FEED_MODE=mock|live` (per feed, e.g. `DARWIN_MODE=mock`) selects the
implementation. The mock adapters replay `fixtures/scenarios/*.json` against a
**simulated clock**, which can be pinned to "today", so a scenario replays at
real speed or accelerated. Planned scenarios:

1. On-time running on the demo route
2. Progressive delay that crosses the user's threshold, then recovers
3. Platform change shortly before departure
4. Full cancellation with a reason, and a part cancellation (terminating short)
5. Late inbound working forming the user's train (propagates via association)
6. Upstream cancellation on the same route; a published incident at a calling point
7. A service crossing midnight, plus a fixture set on a BST changeover Sunday

---

## 5. Worker pipeline

```
feeds ──► ingest queue ──► normalise ─► watched-station filter ─► upsert (services, calls, assoc)
                                                                         │ changed service ids
                                                                         ▼
                                       alert-evaluate queue ─► rules + prediction ─► dedupe ─► email queue ─► EmailTransport
cron jobs: reference refresh (daily), incidents poll (2 min), purge (nightly), HSP backfill (on demand)
```

- The worker exposes `/health` on its own port and reports per-feed health.
- Feed disconnects use exponential backoff with jitter. After a gap, the
  worker runs a `snapshot()` resync for watched stations.
- Every alert check is evaluated at send time against: commute window,
  active day (local), quiet hours (local, wrapping), enabled types and
  threshold.

---

## 6. Prediction rules (`packages/shared/src/prediction`)

These are pure functions with signature
`(input, config) => { risk, reason }`, combined by taking the max risk and
concatenating the reasons. Default config, which needs your sign-off:

| rule | low | medium | high |
|---|---|---|---|
| Forming service | knock-on ≤ 0 | knock-on 1–9 min | ≥ 10 min, or inbound cancelled |
| Upstream | nothing in window | delay ≥ 10 min ahead within 60 min | cancellation ahead within 30 min |
| Incident | none | incident touching a route station | incident at origin or destination |

Knock-on = inbound expected arrival + min turnaround − our scheduled
departure. Min turnaround defaults to 5 min, overridable per station and TOC.

---

## 7. Questions before I start

1. **Existing Next.js/Mongo/RTT code:** should I move it to `legacy/` (my
   proposal) or delete it now?
2. **Darwin:** which product on Rail Data Marketplace are you subscribing to:
   the Push Port (and over which transport) and/or the live departure board
   REST APIs? Please send the schema (XSD) and docs for whichever you use. I
   won't assume message shapes or association category codes.
3. **Network Rail:** TRUST and TD via the Network Rail open data STOMP feed,
   or via RDM? Is TD in scope for the MVP, or is TRUST enough?
4. **HSP:** please send the endpoint docs and auth method for the RDM version.
5. **Incidents:** which source do you mean by "published incidents": NRE
   Knowledgebase incidents, or something else? Docs please.
6. **Reference data:** which source should be authoritative for stations, the
   TIPLOC→CRS mapping and TOCs (CORPUS, KB stations, BPLAN…)? Until then I'll
   ship a small hand-checked fixture for the demo route(s), marked unverified.
   Which route would you like for the demo (e.g. NCL↔YRK, as in the old code)?
7. **Delay Repay:** should users be able to edit the scheme table, or only an
   admin? I'll seed it with clearly marked placeholder bands rather than
   publish figures I can't verify.
8. **Defaults:** are you happy with a 5-minute minimum turnaround, the
   prediction thresholds above, and a 5-minute "material change" delta?
9. **Deploy:** Fly.io or Railway?
