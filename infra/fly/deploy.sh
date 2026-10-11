#!/usr/bin/env bash
# Deploys new code to Fly.io (after infra/fly/setup.sh has run once).
# Run from the repository root. PREFIX defaults to my-commuter-train.
set -euo pipefail
PREFIX="${PREFIX:-my-commuter-train}"
fly deploy . --config infra/fly/api.toml --dockerfile Dockerfile --build-arg APP=api -a "$PREFIX-api" --yes
fly deploy . --config infra/fly/worker.toml --dockerfile Dockerfile --build-arg APP=worker -a "$PREFIX-worker" --ha=false --yes
