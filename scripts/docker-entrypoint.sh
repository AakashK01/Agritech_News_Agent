#!/bin/sh
set -e

if [ "${AGRITECH_POSTGRES_ENABLED}" = "true" ] || [ "${AGRITECH_POSTGRES_ENABLED}" = "1" ]; then
  host="${DB_HOST:-postgres}"
  port="${DB_PORT:-5432}"
  user="${DB_USER:-postgres}"
  echo "Waiting for Postgres at ${host}:${port}..."
  until pg_isready -h "$host" -p "$port" -U "$user" >/dev/null 2>&1; do
    sleep 2
  done
  echo "Postgres is ready."
fi

exec node dist/index.js
