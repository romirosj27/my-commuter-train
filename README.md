# My Commuter Train

Tracks a user's daily commuter trains in Great Britain, alerts them to changes,
predicts knock-on disruption and helps with Delay Repay.

- **Live board** for each commute (home → work, work → home), filtered to the user's time
  windows and operators, with platform changes, cancellations, reasons and a disruption-risk badge.
- **Email alerts** for platform changes, cancellations, delays over a threshold and predicted
  disruption, deduplicated, respecting active days and quiet hours, with one-click unsubscribe.
- **Rule-based prediction**: forming-service knock-on, trouble upstream, published incidents.
- **Delay Repay helper** for journeys the user logs, with an editable per-operator rules table.

The whole app runs end to end on **mock feed data**. Real rail feeds plug in behind adapters
once their official documentation is supplied (see [Data feeds](#data-feeds)).
Design notes: [docs/PLAN.md](docs/PLAN.md).

## Contents

- [Architecture](#architecture)
- [Local setup](#local-setup)
- [Running on mock data](#running-on-mock-data)
- [Environment variables](#environment-variables)
- [Data feeds](#data-feeds)
- [Alerts](#alerts) · [Disruption prediction](#disruption-prediction) · [Delay Repay helper](#delay-repay-helper)
- [API](#api)
- [Testing](#testing)
- [Deployment](#deployment)
- [Known limitations](#known-limitations)

## Architecture

```
apps/web        Vite + React + TypeScript; TanStack Router/Query/Table; shadcn/ui; Tailwind v4
apps/api        Fastify + zod; Better Auth (email + password, verification, reset, deletion)
apps/worker     Always-on: feed ingest, alert engine, email sending, maintenance jobs (BullMQ)
packages/shared Types, zod schemas, London time handling, board view model, alert rules,
                prediction rules, Delay Repay rules, demo reference data (browser-safe)
packages/db     Drizzle schema + migrations, seed, prediction input loader (drizzle-orm is
                re-exported as @mct/db/orm so every package shares one instance)
packages/email  EmailTransport (console for dev, Resend) and email templates
fixtures/       Mock feed scenarios (our own format), replayed by the mock adapters
infra/          Fly.io configs; Postgres init for docker-compose
```

```
feeds (mock|live) ─► ingest queue ─► only services calling at watched stations ─► Postgres
                                                     │ changed services (+ the services they form)
                                                     ▼
                     alert queue ─► alert engine (rules + prediction + dedupe) ─► email queue ─► Resend
maintenance: incidents poll · alert sweep (5 min) · journey arrival times (hourly) · reference refresh · purge
```

**Time:** every instant is stored in UTC. Timetable times are resolved from the service start
date in Europe/London, rolling over midnight and handling the BST/GMT changes, including the
repeated hour in October. Commute windows and quiet hours are London wall-clock times; a window
whose end is before its start wraps midnight.

## Local setup

Requires Node 22+, pnpm 10 and Docker (or a local Postgres 16 and Redis 7).

```bash
pnpm install
cp .env.example .env
docker compose up -d          # Postgres + Redis  (add --profile mail for Mailpit on :8025)
pnpm db:migrate               # creates pg_trgm, applies migrations
pnpm db:seed                  # reference data, placeholder Delay Repay rules, demo users
```

Then, in three terminals:

```bash
pnpm dev:api        # http://localhost:8080 (auth emails are printed here in dev)
pnpm dev:worker     # ingest, alerts, jobs; health on http://localhost:8081/health
pnpm dev:web        # http://localhost:5173 (proxies /api to the API)
```

Sign in as **demo@example.com / demo-password-123** (also `commuter@example.com`), or sign up.
With `EMAIL_TRANSPORT=console`, verification links appear in the API log and alert emails in
the worker log. To try the admin rules editor, set `ADMIN_EMAILS=demo@example.com`.

## Running on mock data

Every feed (Darwin, Network Rail, HSP, incidents, reference data) has a mock adapter that
replays the scenarios in [`fixtures/scenarios`](fixtures/README.md) on a simulated clock, for
any date. They cover on-time running, a growing delay, platform changes, full and part
cancellations, a late inbound train that forms another, a delayed train ahead plus an incident,
a service crossing midnight, and the October clock change.

```bash
# A busy weekday morning at 30x speed (London is UTC+1 in summer, UTC in winter):
MOCK_CLOCK_START=2026-11-10T06:30:00Z MOCK_CLOCK_SPEED=30 pnpm dev:worker
# Just watch the feeds:
MOCK_CLOCK_START=2026-11-10T06:30:00Z MOCK_CLOCK_SPEED=60 pnpm --filter @mct/worker replay
```

The worker stores only services that call at stations in someone's commute; the seeded demo
commutes (NCL⇄YRK, DAR⇄LDS, YRK⇄NCL) make it ingest the mock trains. The web app's "today"
is the real date, so to see the board for the simulated morning, run the clock on today's date
or use the **Tomorrow** view. `MOCK_SCENARIO=on-time,forming-delay` restricts the replay.

## Environment variables

See [`.env.example`](.env.example). The API and worker validate their environment at startup and
refuse to start with invalid values.

| variable | used by | notes |
|---|---|---|
| `DATABASE_URL` | api, worker | Postgres 16 |
| `REDIS_URL` | api, worker | BullMQ queues; API rate limits (fails open if Redis is down) |
| `TEST_DATABASE_URL` | tests | a throwaway database; tests drop and recreate its schema |
| `NODE_ENV`, `LOG_LEVEL` | api, worker | JSON logs (pino); pretty in dev on a TTY |
| `API_PORT` | api | default 8080 |
| `API_PUBLIC_URL` | api, worker | public URL of the API: auth email links, unsubscribe links |
| `WEB_URL` | api, worker | public URL of the web app: CORS origin, links in emails |
| `COOKIE_DOMAIN` | api | production with sibling subdomains, e.g. `example.com` |
| `BETTER_AUTH_SECRET` | api | ≥ 32 random characters |
| `RATE_LIMIT_PER_MIN`, `AUTH_RATE_LIMIT_PER_MIN` | api | per IP; Better Auth adds tighter per-endpoint limits |
| `ADMIN_EMAILS` | api | comma-separated; may edit Delay Repay rules |
| `EMAIL_TRANSPORT` | api, worker | `console` (dev) or `resend` |
| `EMAIL_FROM`, `RESEND_API_KEY` | api, worker | sender must be a domain verified in Resend |
| `WORKER_HEALTH_PORT` | worker | default 8081 |
| `INCIDENTS_POLL_SEC`, `ALERT_SWEEP_SEC` | worker | defaults 120 and 300 |
| `PREDICTION_CONFIG` | api, worker | JSON overrides for prediction thresholds |
| `DARWIN_MODE`, `NETWORK_RAIL_MODE`, `HSP_MODE`, `INCIDENTS_MODE`, `REFERENCE_MODE` | worker | `mock` or `live` (live adapters are placeholders) |
| `MOCK_SCENARIO`, `MOCK_CLOCK_START`, `MOCK_CLOCK_SPEED` | worker | mock replay controls |
| `VITE_API_URL` | web (build time) | the API's public URL in production; empty in dev |

## Data feeds

Each feed sits behind an interface in [`packages/shared/src/feeds.ts`](packages/shared/src/feeds.ts)
that carries only our own normalised types. Each feed has a mock adapter (working) and a live
adapter (`apps/worker/src/feeds/<feed>/live.ts`), and all wire-format parsing is isolated in
`apps/worker/src/feeds/<feed>/parse.ts`.

| feed | used for | live status |
|---|---|---|
| Darwin (Rail Data Marketplace) | schedules, forecasts, actuals, platforms, cancellations, associations | **placeholder**: needs the official schema and docs |
| Network Rail (TRUST, TD) | network-wide movements for the upstream rule | **placeholder** |
| HSP | backfilling arrival times for logged journeys | **placeholder** |
| Incidents | published incidents for the incident rule | **placeholder**: source to be confirmed |
| Reference data | stations (CRS), TIPLOC→CRS, operators | **placeholder**: the demo data is hand-entered and unverified |

Places that need confirming against official documentation are marked `FEED-SCHEMA-PLACEHOLDER`
or `RAIL-DATA-CONFIRM` in the code (for example the midnight rollover rule and the association
categories that mean "forms").

## Alerts

The worker evaluates every changed service (and, every few minutes, every
service departing soon) against users' commutes:

- **Matching:** the train must call at the commute's two stations in the right order, run
  by an allowed operator, and depart inside the outbound or return window. A window that
  wraps midnight counts towards the day it opened. The user must travel that day, alerts
  must be on, and it must not be quiet hours (checked in London time when the alert
  would be sent).
- **Triggers:** platform change at your station, cancellation (including terminating
  before your station), delay at or above your threshold, and predicted disruption
  (medium or high risk). Once the train has left, only "won't reach your station" is still sent.
- **Dedupe:** every alert is logged with a unique key of (user, service, type, value,
  previous alert), so one change sends one email even if it is evaluated twice. Follow-ups
  go only when the value changes materially: a delay moving by `materialDelayDeltaMin`
  (5 min), a new platform, a reinstatement, or a recovery.
- **Unsubscribe:** every email has a one-click unsubscribe (`List-Unsubscribe` +
  `List-Unsubscribe-Post`, RFC 8058) and a link to settings. `GET /api/unsubscribe`
  shows a confirmation page; `POST` turns that commute's alerts off.

With `EMAIL_TRANSPORT=console`, alert emails are printed in the worker log.

## Disruption prediction

Three rule-based predictions (pure functions in `packages/shared/src/prediction`),
each giving `{ risk: low | medium | high, reason }`. They're combined by taking the highest
risk and keeping every reason. `PredictionInputs` (`@mct/db`) gathers their inputs, so the
board, the service page and alerts all see the same result.

| rule | medium | high |
|---|---|---|
| Forming service | the inbound unit arrives too late to leave on time after the minimum turnaround (any knock-on) | knock-on ≥ 10 min, or the inbound train is cancelled |
| Upstream | a train ahead on the same route (same two stations) is ≥ 10 min late within 60 min; or recent network events on the route show ≥ 10 min delays or a cancellation | a train ahead is cancelled within 30 min |
| Published incident | an active incident affects a station on the route | it affects your boarding or alighting station |

Thresholds are configurable with `PREDICTION_CONFIG` (JSON, any subset), e.g.

```bash
PREDICTION_CONFIG='{"minTurnaroundMin":6,"turnaroundOverrides":{"NCL":8,"NCL:TP":10},"upstream":{"delayWindowMin":45}}'
```

## Delay Repay helper

Only journeys a user says they made are ever assessed; nothing lists other trains to claim for.

- **Suggestions:** for today or yesterday, one train per direction of the default commute. It's
  your usual train (the departure time and operator you log most), or the first train in your
  window if you have no history yet. You confirm it (times come from the live data) or enter a
  different train by hand. London times; an arrival after midnight is handled.
- **Delay:** worked out from actual arrival times as real elapsed minutes, across midnight
  and the clock changes. A worker job (hourly) fills in missing arrival times for logged journeys,
  from live data while it's held and from HSP after that.
- **Eligibility:** uses the operator's bands in `delay_repay_schemes` (from inclusive, up to
  exclusive; % of a single or return; season tickets get the band only). Each result reminds the
  user to check the operator's current terms, and unverified schemes are flagged.
- **Rules:** seeded as **placeholders** (`verified_on` null). Admins listed in `ADMIN_EMAILS`
  edit them at `/admin/delay-repay` (`PUT /api/delay-repay/schemes/:toc`).

| route | notes |
|---|---|
| `GET /api/journeys` · `POST /api/journeys` · `GET, PATCH, DELETE /api/journeys/:id` | own journeys with eligibility; POST takes `{ serviceId, originCrs, destCrs }` or a manual entry |
| `GET /api/journeys/suggestions?date=` | usual-train suggestions (not saved until confirmed) |
| `GET /api/delay-repay/schemes` · `PUT /api/delay-repay/schemes/:toc` | read for all; edit for admins |

## API

All input is validated with zod. Signed-in routes need a Better Auth session cookie.

| route | notes |
|---|---|
| `GET /health` | database and Redis |
| `/api/auth/*` | Better Auth: sign-up, verify email, sign-in/out, password reset, `delete-user` (GDPR deletion; data cascades) |
| `GET /api/me` · `GET /api/me/export` | profile (with `isAdmin`); GDPR JSON export |
| `GET /api/stations?q=` · `GET /api/operators` | autocomplete on name or CRS (prefix, word, trigram) |
| `GET, POST /api/commutes` · `GET, PATCH, DELETE /api/commutes/:id` · `POST /api/commutes/:id/default` | one default per user |
| `GET, PUT /api/commutes/:id/alert-settings` | |
| `GET /api/commutes/:id/board?direction=outbound\|return&date=` | the commute's board, with risk |
| `GET /api/board?from&to&date&start&end&operators` | station-to-station board |
| `GET /api/services/:id?from&to` | calling pattern, forming/formed services, risk for your stops |
| `GET, POST /api/unsubscribe?token=` | confirmation page / one-click unsubscribe (RFC 8058) |
| journeys and Delay Repay | see [Delay Repay helper](#delay-repay-helper) |

## Testing

```bash
pnpm typecheck
pnpm test          # needs TEST_DATABASE_URL (Postgres) for the integration tests
```

- **Unit:** London time (midnight, BST/GMT, repeated and missing hours), board status, alert
  decisions (windows, active days, quiet hours, dedupe, material change), prediction rules, Delay
  Repay delay and bands, email templates, web components.
- **Integration (Postgres):** schema constraints, ingest of every mock scenario, the alert engine
  replaying a morning, prediction inputs, journey arrival times, and the API's main flows over HTTP
  (sign-up → verify → sign-in, password reset, commutes, boards, journeys, rules, unsubscribe,
  export and deletion, rate limiting).

CI (`.github/workflows/ci.yml`) runs typecheck, tests and the web build against Postgres and Redis.

## Deployment

**Database and Redis:** any managed Postgres 16 (needs the `pg_trgm` extension) and Redis 7.

**API and worker:** one [`Dockerfile`](Dockerfile), built per app:

```bash
docker build --build-arg APP=api    -t mct-api .
docker build --build-arg APP=worker -t mct-worker .
```

Run migrations before each API release (the Fly config does this as its `release_command`):

```bash
node --import tsx ../../packages/db/src/migrate.ts     # from /app/apps/api in the image
node --import tsx ../../packages/db/src/seed.ts        # first deploy only: reference data + placeholder rules
```

Don't run the demo-user seed in production.

- **Fly.io:** [`infra/fly/api.toml`](infra/fly/api.toml) and [`infra/fly/worker.toml`](infra/fly/worker.toml).
  `fly secrets set DATABASE_URL=… REDIS_URL=… BETTER_AUTH_SECRET=… RESEND_API_KEY=…` on both
  apps, set the public URLs, then `fly deploy --config infra/fly/api.toml` (and the worker) from
  the repo root. Keep exactly **one** worker machine running.
- **Railway:** create two services from this repo using the root `Dockerfile`, with the
  `APP=api` / `APP=worker` build argument, the same variables, and a pre-deploy command for the
  API's migrations. Health checks are on `/health` (8080 for the API, 8081 for the worker).

**Web:** Cloudflare Pages. Build command `pnpm install --frozen-lockfile && pnpm --filter @mct/web build`,
output directory `apps/web/dist`, and `VITE_API_URL=https://api.example.com`. `public/_redirects`
handles client-side routes and `public/_headers` sets security and cache headers.

**Web on Vercel (alternative):** `vercel.json` builds only the web app (framework Vite, output
`apps/web/dist`, SPA fallback). Leave the project's Root Directory as the repository root. Vercel
can't host the worker (it's always on), so the API and worker still run elsewhere (Fly.io or
Railway). Set `VITE_API_URL` in the Vercel project's environment variables, and set `WEB_URL` on
the API to the Vercel URL.

**Domains and cookies:** serve the web app and API from sibling subdomains of one domain (for
example `app.example.com` and `api.example.com`) and set `COOKIE_DOMAIN=example.com`,
`WEB_URL=https://app.example.com` and `API_PUBLIC_URL=https://api.example.com`. Session cookies are
then first-party (SameSite=Lax, Secure); unrelated domains would make them third-party cookies,
which browsers block.

**Email:** verify the sending domain in Resend, set `EMAIL_TRANSPORT=resend`, `EMAIL_FROM` and
`RESEND_API_KEY` on both the API (auth emails) and the worker (alerts).

## Known limitations

- Live feed adapters are placeholders until the official Darwin, Network Rail, HSP and incidents
  documentation is supplied. The demo reference data (stations, TIPLOCs, operators) and the
  Delay Repay bands are unverified placeholders and are flagged as such in the UI.
- If an unwatched inbound train's schedule arrives before both its association and the watched
  service it forms, the forming link is lost (depends on Darwin message ordering; to revisit
  with the docs).
- Quiet hours drop alerts rather than queueing them; the 5-minute sweep resends anything still
  relevant once quiet hours end.
- The web app's "today" is the browser's date, not the mock clock.
