#!/bin/sh
set -e

if [ "${1:-}" = "migrate" ]; then
  echo "[migration] Running database migrations..."
  node_modules/.bin/drizzle-kit migrate
  echo "[migration] Running idempotent legacy-domain backfill..."
  node_modules/.bin/tsx scripts/backfill-project-domains.ts
  echo "[migration] Migrations and backfill complete."
  exit 0
fi

exec "$@"
