#!/usr/bin/env bash
# export-live.sh  - pull a fresh snapshot from the LIVE Railway MySQL into the repo.
#   Run on the CLIENT laptop (has git push creds + mysql client). Paste the
#   MYSQL_PUBLIC_URL value from the MySQL service's Variables tab. Requires the
#   service to be awake (enable Always On on Railway).
set -euo pipefail

cd "$(dirname "$0")/../.."
DUMP="deploy/db/souvari-live.sql"

read -r -p "Paste MYSQL_PUBLIC_URL (mysql://user:pass@host:port/railway): " PUB
[[ -n "$PUB" ]] || { echo "URL required."; exit 1; }

URL="${PUB#mysql://}"; USER="${URL%%:*}"
REST="${URL#*:}"; PASS="${REST%%@*}"
HOSTPORT="${REST#*@}"; HOST="${HOSTPORT%%:*}"
PORT="${HOSTPORT#*:}"; PORT="${PORT%%/*}"; DB="${HOSTPORT##*/}"

echo "Exporting live DB '$DB' from $HOST:$PORT ..."
export MYSQL_PWD="$PASS"
mysql -h "$HOST" -P "$PORT" -u "$USER" --ssl-mode=PREFERRED -N -e "SELECT 1" "$DB" \
  || { echo "ERROR: live DB unreachable (proxy down / service asleep?). Enable Always On and retry."; exit 1; }

mysqldump -h "$HOST" -P "$PORT" -u "$USER" --ssl-mode=PREFERRED \
  --default-character-set=utf8mb4 --single-transaction \
  --routines --triggers --set-gtid-purged=OFF "$DB" > "$DUMP"

echo "Exported: $DUMP ($(du -h "$DUMP" | cut -f1))"
git add "$DUMP" && git commit -m "db: snapshot live $DB" && git push origin master
echo "Done. Snapshot pushed."