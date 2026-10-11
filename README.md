# My Commuter Train

Tracks a user's daily commuter trains in Great Britain, alerts them to changes,
predicts knock-on disruption and helps with Delay Repay. See
[docs/PLAN.md](docs/PLAN.md) for the design. The full README (deployment, all
env vars) arrives in Phase 8.

> The previous Next.js/MongoDB prototype has moved to `legacy/` for reference.

## Status

- Phase 1 (done): monorepo scaffold, docker-compose, database schema, reference data and mock feed adapters.
- Phase 2 (done): worker ingest from the mock feeds, and the live board API.
- Phase 3 (done): accounts (Better Auth, email verification, password reset, GDPR export and deletion) and commute setup, in the API and web app.
- Phase 4 (done): live board UI (home page) and service detail.
- Phase 5 (done): alert engine and email.
- Next: prediction rules wired into the board and alerts (Phase 6).

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
  (Phase 6). Once the train has left, only "won't reach your station" is still sent.
- **Dedupe:** every alert is logged with a unique key of (user, service, type, value,
  previous alert), so one change sends one email even if it is evaluated twice. Follow-ups
  go only when the value changes materially: a delay moving by `materialDelayDeltaMin`
  (5 min), a new platform, a reinstatement, or a recovery.
- **Unsubscribe:** every email has a one-click unsubscribe (`List-Unsubscribe` +
  `List-Unsubscribe-Post`, RFC 8058) and a link to settings. `GET /api/unsubscribe`
  shows a confirmation page; `POST` turns that commute's alerts off.

With `EMAIL_TRANSPORT=console`, alert emails are printed in the worker log.

## Local setup

Requires Node 22+, pnpm 10 and Docker (or a local Postgres 16 and Redis 7).

```bash
pnpm install
cp .env.example .env
docker compose up -d            # postgres + redis (add --profile mail for mailpit)
pnpm db:migrate                 # creates pg_trgm and applies migrations
pnpm db:seed                    # reference data, placeholder Delay Repay schemes, demo users
pnpm typecheck && pnpm test
```

## Running the app

```bash
pnpm dev:api       # http://localhost:8080 (auth emails are printed to this log in dev)
pnpm dev:worker    # ingest + maintenance jobs; health on :8081/health
pnpm dev:web       # http://localhost:5173 (proxies /api to the API)
```

Sign in as `demo@example.com` / `demo-password-123`, or sign up. To see a busy
morning board, start the worker with the mock clock at a weekday morning, e.g.
`MOCK_CLOCK_START=$(date -u +%Y-%m-%d)T07:20:00Z pnpm dev:worker` (London is UTC+1 in summer). With
`EMAIL_TRANSPORT=console`, the verification link appears in the API log.
The worker persists only services calling at stations in someone's commute,
so the seeded demo commutes (NCL⇄YRK, DAR⇄LDS, YRK⇄NCL) make it ingest the mock trains.

API so far:

| route | notes |
|---|---|
| `GET /health` | database and Redis checks |
| `GET /api/stations?q=` | autocomplete on name or CRS |
| `GET /api/operators` | |
| `GET /api/board?from=NCL&to=YRK&date=&start=07:00&end=09:00&operators=TP,GR` | London window; `end` <= `start` wraps midnight; the default is the whole day |
| `GET /api/services/:id` | calling pattern, and the services it is formed by and forms |
| `/api/auth/*` | Better Auth: sign-up, verify email, sign-in/out, password reset, `delete-user` (GDPR deletion) |
| `GET, POST /api/commutes` · `GET, PATCH, DELETE /api/commutes/:id` | signed-in; one default per user |
| `POST /api/commutes/:id/default` · `GET, PUT /api/commutes/:id/alert-settings` | |
| `GET /api/commutes/:id/board?direction=outbound\|return&date=` | the commute's windows and operators |
| `GET /api/me` · `GET /api/me/export` | profile; GDPR JSON export |

## Running on mock data

Every feed is behind an adapter, with `mock` and `live` implementations
chosen per feed by `DARWIN_MODE`, `NETWORK_RAIL_MODE`, `HSP_MODE`,
`INCIDENTS_MODE` and `REFERENCE_MODE`. Live adapters are placeholders until the
official feed documentation is supplied.

The mocks replay the scenarios in `fixtures/scenarios/` against a simulated
clock. To watch them:

```bash
# replay from 06:30 on a given day at 60x speed
MOCK_CLOCK_START=2026-11-10T06:30:00Z MOCK_CLOCK_SPEED=60 pnpm --filter @mct/worker replay
```

`MOCK_SCENARIO` restricts replay to named scenarios (comma-separated). See
[fixtures/README.md](fixtures/README.md) for the fixture format.

## Layout

```
apps/web           Vite + React web app (TanStack Router/Query, shadcn/ui, Tailwind v4)
apps/api           Fastify API (Better Auth)
apps/worker        feed adapters (mock + live placeholders), ingest, maintenance jobs
packages/shared    domain types, zod schemas, time handling, adapter interfaces, demo reference data
packages/db        Drizzle schema, migrations, seed (drizzle-orm is re-exported as @mct/db/orm)
packages/email     EmailTransport (console, Resend) and templates
fixtures/          mock scenarios
legacy/            previous prototype (to be removed)
```
