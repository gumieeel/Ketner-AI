#!/usr/bin/env bash
# Проверка резервной копии production: восстановить её в ОДНОРАЗОВЫЙ кластер и сравнить отпечаток данных
# с отпечатком, снятым на production в том же снимке, что и копия (SECURITY_PRIVILEGE_AUDIT.md, раздел 7).
#
#   bash docs/security-review/verify-restore.sh <копия.dump> <отпечаток-production.txt>
#
# PGBIN — каталог bin той же major-версии Postgres, что и production (или новее): например
#   PGBIN=/usr/lib/postgresql/17/bin. Строки подключения к production скрипт не получает и не печатает.
set -euo pipefail
DUMP=${1:?usage: verify-restore.sh <dump> <fingerprint>}
EXPECTED=${2:?usage: verify-restore.sh <dump> <fingerprint>}
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DIR=${VERIFY_DIR:-/var/lib/postgresql/ketner-restore-check}
PORT=${VERIFY_PORT:-5436}
HERE=$(cd "$(dirname "$0")" && pwd)
C="-h 127.0.0.1 -p $PORT -U postgres"
WORK=$(mktemp -d); chmod 755 "$WORK"
cp "$DUMP" "$WORK/copy.dump"; chmod 644 "$WORK/copy.dump"
trap 'su postgres -c "$PGBIN/pg_ctl -D $DIR/data stop -m fast >/dev/null" || true; rm -rf "$WORK"' EXIT

su postgres -c "rm -rf $DIR && mkdir -p $DIR && $PGBIN/initdb -D $DIR/data -A trust -U postgres >/dev/null \
  && $PGBIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log start >/dev/null"
echo "restore cluster: $(psql -X $C -tAc 'select version()' | cut -d' ' -f1-2)"
# Роли, на которые в копии могут ссылаться владельцы и GRANT (в Supabase они есть; здесь — заглушки без входа).
for r in anon authenticated service_role authenticator supabase_admin supabase_auth_admin supabase_storage_admin \
         supabase_realtime_admin supabase_replication_admin dashboard_user pgbouncer ${VERIFY_EXTRA_ROLES:-}; do
  psql -X $C -qc "DO \$\$ BEGIN CREATE ROLE $r NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$"
done
psql -X $C -qc "CREATE DATABASE restored"

echo "dump: $(du -h "$WORK/copy.dump" | cut -f1); objects listed: $("$PGBIN/pg_restore" -l "$WORK/copy.dump" | grep -vc '^;'); tables with data in public: $("$PGBIN/pg_restore" -l "$WORK/copy.dump" | grep -c ' TABLE DATA public ')"
# Восстанавливается схема public (таблицы приложения); схемы Supabase (auth, storage, …) в обычный Postgres
# не восстанавливаются, но остаются в копии для восстановления в Supabase.
"$PGBIN/pg_restore" $C -d restored --schema=public --exit-on-error "$WORK/copy.dump"
echo "restore: OK (no errors)"

psql -X $C -d restored -tA -F'|' -f "$HERE/table-fingerprint.sql" > "$WORK/restored.txt"
if diff <(grep -v '^$' "$EXPECTED") <(grep -v '^$' "$WORK/restored.txt"); then
  echo "PASS  restored copy matches production fingerprint: $(grep -vc '^$' "$WORK/restored.txt") tables, row counts + md5 identical"
else
  echo "FAIL  restored copy differs from production fingerprint (lines above) — do NOT apply any migration"
  exit 1
fi
