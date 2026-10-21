#!/usr/bin/env bash
# Export the local iave_clinic database, commit it to the repo (deploy/db/souvari-live.sql)
# and push, so the client laptop can restore it with restore-client.bat.
set -euo pipefail

cd "$(dirname "$0")/../.." # repo root
DUMP="deploy/db/souvari-live.sql"
DB="${MYSQL_DB:-iave_clinic}"

command -v mysqldump >/dev/null || { echo "ERROR: mysqldump not found"; exit 1; }

read -rsp "MySQL root password (blank if none): " PW; echo

MYSQL_PWD="$PW" mysqldump -u root \
  --default-character-set=utf8mb4 \
  --single-transaction \
  --routines --triggers \
  --set-gtid-purged=OFF \
  "$DB" > "$DUMP"

echo "Exported: $DUMP ($(du -h "$DUMP" | cut -f1))"

git add "$DUMP"
git commit -m "db: snapshot $DB"
git push origin master

echo "Done. New snapshot is live in the repo."