#!/usr/bin/env bash
# One-time Fly.io setup for My Commuter Train. Run from the repository root
# after `fly auth login`. Safe to re-run: existing apps, volumes and secrets
# are kept unless you pass new values.
#
# Required:
#   DATABASE_URL      Fly Managed Postgres connection string (see docs/DEPLOY_FLY.md)
#   WEB_URL           where the web app is served, e.g. https://app.example.com
#   EMAIL_FROM        e.g. "My Commuter Train <alerts@example.com>" (domain verified in Resend)
#   RESEND_API_KEY
# Optional:
#   FLY_ORG (personal)  REGION (lhr)  PREFIX (my-commuter-train)
#   API_PUBLIC_URL (https://$PREFIX-api.fly.dev)  COOKIE_DOMAIN  ADMIN_EMAILS
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL (see docs/DEPLOY_FLY.md)}"
: "${WEB_URL:?Set WEB_URL}"
: "${EMAIL_FROM:?Set EMAIL_FROM}"
: "${RESEND_API_KEY:?Set RESEND_API_KEY}"
FLY_ORG="${FLY_ORG:-personal}"
REGION="${REGION:-lhr}"
PREFIX="${PREFIX:-my-commuter-train}"
API_APP="$PREFIX-api"
WORKER_APP="$PREFIX-worker"
REDIS_APP="$PREFIX-redis"
API_PUBLIC_URL="${API_PUBLIC_URL:-https://$API_APP.fly.dev}"

command -v fly >/dev/null || { echo "Install flyctl first: https://fly.io/docs/flyctl/install/"; exit 1; }
fly auth whoami >/dev/null || { echo "Run 'fly auth login' first"; exit 1; }
[ -f Dockerfile ] && [ -d infra/fly ] || { echo "Run this from the repository root"; exit 1; }

app_exists() { fly status -a "$1" >/dev/null 2>&1 || fly apps list 2>/dev/null | grep -q "^$1\b"; }
ensure_app() {
  if app_exists "$1"; then echo "• app $1 exists"; else fly apps create "$1" --org "$FLY_ORG"; fi
}

echo "== Apps"
ensure_app "$REDIS_APP"
ensure_app "$API_APP"
ensure_app "$WORKER_APP"

echo "== Redis (private, persisted, noeviction)"
if ! fly secrets list -a "$REDIS_APP" 2>/dev/null | grep -q REDIS_PASSWORD; then
  REDIS_PASSWORD="$(openssl rand -hex 24)"
  fly secrets set REDIS_PASSWORD="$REDIS_PASSWORD" -a "$REDIS_APP" --stage
  echo "  generated a Redis password"
else
  REDIS_PASSWORD="${REDIS_PASSWORD:?Redis already has a password; pass REDIS_PASSWORD to reconfigure the other apps}"
fi
if ! fly volumes list -a "$REDIS_APP" 2>/dev/null | grep -q redis_data; then
  fly volumes create redis_data --region "$REGION" --size 1 -a "$REDIS_APP" --yes
fi
fly deploy . --config infra/fly/redis.toml --dockerfile infra/redis/Dockerfile -a "$REDIS_APP" --ha=false --yes
REDIS_URL="redis://:$REDIS_PASSWORD@$REDIS_APP.internal:6379/0?family=6"

echo "== Secrets"
common=(
  DATABASE_URL="$DATABASE_URL"
  REDIS_URL="$REDIS_URL"
  RESEND_API_KEY="$RESEND_API_KEY"
  EMAIL_FROM="$EMAIL_FROM"
  WEB_URL="$WEB_URL"
  API_PUBLIC_URL="$API_PUBLIC_URL"
)
api_only=(BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-$(openssl rand -base64 48 | tr -d '\n')}")
[ -n "${ADMIN_EMAILS:-}" ] && api_only+=(ADMIN_EMAILS="$ADMIN_EMAILS")
[ -n "${COOKIE_DOMAIN:-}" ] && api_only+=(COOKIE_DOMAIN="$COOKIE_DOMAIN")
if fly secrets list -a "$API_APP" 2>/dev/null | grep -q BETTER_AUTH_SECRET && [ -z "${BETTER_AUTH_SECRET:-}" ]; then
  # Keep the existing auth secret (changing it signs everyone out).
  api_only=("${api_only[@]:1}")
fi
fly secrets set "${common[@]}" "${api_only[@]}" -a "$API_APP" --stage
fly secrets set "${common[@]}" -a "$WORKER_APP" --stage

echo "== Deploy API (runs migrations and reference data first)"
fly deploy . --config infra/fly/api.toml --dockerfile Dockerfile --build-arg APP=api -a "$API_APP" --yes

echo "== Deploy worker (exactly one machine)"
fly deploy . --config infra/fly/worker.toml --dockerfile Dockerfile --build-arg APP=worker -a "$WORKER_APP" --ha=false --yes
fly scale count 1 -a "$WORKER_APP" --yes

echo
echo "Done."
echo "  API:    $API_PUBLIC_URL/health"
echo "  Worker: fly logs -a $WORKER_APP"
echo "Next: point the web app at the API (docs/DEPLOY_FLY.md, 'Connect the web app')."
