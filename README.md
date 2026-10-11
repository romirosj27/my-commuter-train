# My Commuter Train

Tracks a user's daily commuter trains in Great Britain, alerts them to changes,
predicts knock-on disruption and helps with Delay Repay. See
[docs/PLAN.md](docs/PLAN.md) for the design. The full README (deployment, all
env vars) arrives in Phase 8.

> The previous Next.js/MongoDB prototype has moved to `legacy/` for reference.

## Status

Phase 1 is done: monorepo scaffold, docker-compose, database schema, reference
data and mock feed adapters. `apps/api` and `apps/web` come in Phases 2–4.

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
apps/worker        feed adapters (mock + live placeholders); ingest and alerts from Phase 2
packages/shared    domain types, zod schemas, time handling, adapter interfaces, demo reference data
packages/db        Drizzle schema, migrations, seed
fixtures/          mock scenarios
legacy/            previous prototype (to be removed)
```
