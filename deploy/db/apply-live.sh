#!/usr/bin/env bash
# apply-live.sh  - load the committed snapshot (deploy/db/souvari-live.sql) into a MySQL DB.
#   Railway console: just run  bash deploy/db/apply-live.sh   (targets 'railway')
#   Local:           bash deploy/db/apply-live.sh             (targets 'iave_clinic')
set -euo pipefail

cd "$(dirname "$0")/../.." # repo root
DUMP="deploy/db/souvari-live.sql"

if [[ -n "${MYSQL_ROOT_PASSWORD:-}" ]]; then
  DB="${MYSQL_DB:-railway}"
  export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
  echo "Mode: Railway console -> target DB '$DB'"
else
  DB="${MYSQL_DB:-iave_clinic}"
  read -rsp "MySQL root password (blank if none): " PW; echo
  export MYSQL_PWD="$PW"
  echo "Mode: local -> target DB '$DB'"
fi

if [[ ! -s "$DUMP" ]]; then
  echo "Fetching snapshot from GitHub..."
  (command -v curl >/dev/null || apt-get install -y curl >/dev/null 2>&1 || true)
  curl -fsSL -o "$DUMP" \
    https://raw.githubusercontent.com/kurtpogi272-arch/souvari-skin-lab/master/deploy/db/souvari-live.sql \
    || { echo "ERROR: could not fetch snapshot"; exit 1; }
fi
echo "Using: $DUMP"

echo "Recreating database '$DB'..."
mysql -uroot --default-character-set=utf8mb4 \
  -e "DROP DATABASE IF EXISTS \`$DB\`; CREATE DATABASE \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"

echo "Importing..."
mysql -uroot --default-character-set=utf8mb4 "$DB" < "$DUMP"

echo "Verifying..."
mysql -uroot "$DB" -e "SELECT 'tables' k,COUNT(*) v FROM information_schema.tables WHERE table_schema='$DB' UNION ALL SELECT 'appointments',COUNT(*) FROM appointments UNION ALL SELECT 'customers',COUNT(*) FROM customers UNION ALL SELECT 'treatment_records',COUNT(*) FROM treatment_records UNION ALL SELECT 'transactions',COUNT(*) FROM transactions UNION ALL SELECT 'users',COUNT(*) FROM users;"
echo "Done."