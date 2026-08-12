#!/bin/sh
set -e

echo "[entrypoint] Running database migrations..."
node_modules/.bin/drizzle-kit migrate
echo "[entrypoint] Migrations complete."

exec "$@"
