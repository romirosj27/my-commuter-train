# My Commuter Train

Tracks a user's daily commuter trains in Great Britain, alerts them to changes,
predicts knock-on disruption and helps with Delay Repay. See
[docs/PLAN.md](docs/PLAN.md) for the design. The full README (deployment, all
env vars) arrives in Phase 8.

> The previous Next.js/MongoDB prototype has moved to `legacy/` for reference.

## Status

- Phase 1 (done): monorepo scaffold, docker-compose, database schema, reference data and mock feed adapters.
- Phase 2 (done): worker ingest from the mock feeds, and the live board API.
- Next: auth and commute setup (Phase 3); `apps/web` arrives in Phases 3–4.

## Local setup

Requires Node 22+, pnpm 10 and Docker (or a local Postgres 16 and Redis 7).

```bash
pnpm install
cp .env.example .env
docker compose up -d            # postgres + redis (add --profile mail for mailpit)
pnpm db:migrate                 # creates pg_trgm and applies migrations
pnpm db:seed                    # reference data + placeholder Delay Repay schemes
pnpm typecheck && pnpm test
```

## Running the worker and API

```bash
pnpm dev:worker    # ingest + maintenance jobs; health on :8081/health
pnpm dev:api       # http://localhost:8080
```

The worker persists only services calling at stations in someone's commute.
Until Phase 3 adds sign-up, create a commute by hand:

```sql
insert into "user"(id, name, email) values ('dev', 'Dev', 'dev@example.com');
insert into commutes(user_id, name, home_crs, work_crs, outbound_start, outbound_end,
                     return_start, return_end, active_days, is_default)
values ('dev', 'Dev', 'NCL', 'YRK', '07:00', '09:30', '17:00', '19:00', 31, true);
```

API so far:

| route | notes |
|---|---|
| `GET /health` | database and Redis checks |
| `GET /api/stations?q=` | autocomplete on name or CRS |
| `GET /api/operators` | |
| `GET /api/board?from=NCL&to=YRK&date=&start=07:00&end=09:00&operators=TP,GR` | London window; `end` <= `start` wraps midnight; the default is the whole day |
| `GET /api/services/:id` | calling pattern, and the services it is formed by and forms |

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
apps/api           Fastify API
apps/worker        feed adapters (mock + live placeholders), ingest, maintenance jobs
packages/shared    domain types, zod schemas, time handling, adapter interfaces, demo reference data
packages/db        Drizzle schema, migrations, seed
fixtures/          mock scenarios
legacy/            previous prototype (to be removed)
```
