#!/usr/bin/env sh
set -eu
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${1:-backup-${STAMP}.sql.gz}"
docker compose -f compose.production.yml exec -T postgres \
  pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${OUT}"
printf 'Backup written to %s\n' "${OUT}"
