#!/bin/sh
# Runs before each API release (Fly.io release_command): apply database
# migrations, then upsert reference data and seed placeholder Delay Repay
# rules (idempotent; never overwrites rules an admin has edited).
set -e
cd "$(dirname "$0")/.."
node --import tsx ../../packages/db/src/migrate.ts
node --import tsx ../../packages/db/src/seed.ts
