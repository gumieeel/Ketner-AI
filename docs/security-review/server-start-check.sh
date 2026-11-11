#!/usr/bin/env bash
# Сервер Ketner стартует с DATABASE_URL на заданных версиях Node (без флага --no-experimental-sqlite)
# и проходит смоук-тест. ОДНОРАЗОВЫЙ кластер Postgres, не база проекта.
#   bash docs/security-review/server-start-check.sh /opt/node22/bin/node /opt/node24/bin/node
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DIR=/var/lib/postgresql/ketner-start-check
PG_PORT=${PG_PORT:-5438}
APP_PORT=${APP_PORT:-8898}
HERE=$(cd "$(dirname "$0")" && pwd)
API="${API_DIR:-$HERE/../../apps/mock-api}"
WORK=$(mktemp -d)
SU="psql -X -h 127.0.0.1 -p $PG_PORT -U postgres -v ON_ERROR_STOP=1 -q"
cp -a "$API/data" "$WORK/data-backup" 2>/dev/null || true
cleanup() {
  pkill -f "src/server.ts" 2>/dev/null || true
  su postgres -c "$PGBIN/pg_ctl -D $DIR/data stop -m fast >/dev/null" || true
  if [ -d "$WORK/data-backup" ]; then rm -rf "$API/data" && cp -a "$WORK/data-backup" "$API/data"; fi
  rm -rf "$WORK"
}
trap cleanup EXIT
su postgres -c "rm -rf $DIR && mkdir -p $DIR && $PGBIN/initdb -D $DIR/data -A trust -U postgres >/dev/null \
  && $PGBIN/pg_ctl -D $DIR/data -o '-p $PG_PORT -k $DIR' -l $DIR/log start >/dev/null"
$SU -c "CREATE ROLE ketner_backend LOGIN NOSUPERUSER BYPASSRLS"
for NODE in "$@"; do
  db="app_$(basename "$(dirname "$(dirname "$NODE")")")"
  $SU -c "CREATE DATABASE $db OWNER ketner_backend"
  $SU -d "$db" -c "ALTER SCHEMA public OWNER TO ketner_backend"
  echo "== $($NODE -v) ($NODE), node:sqlite available: $($NODE -e "import('node:sqlite').then(()=>console.log('yes'),()=>console.log('no'))")"
  for round in 1 2; do   # 1 — пустая база (создание таблиц), 2 — повторный старт на готовой базе
    log="$WORK/server-$db-$round.log"
    (cd "$API" && DATABASE_URL="postgres://ketner_backend@127.0.0.1:$PG_PORT/$db" NODE_ENV=development PORT=$APP_PORT \
       "$NODE" --import tsx src/server.ts > "$log" 2>&1) &
    pid=$!
    up=no
    for i in $(seq 1 60); do
      if curl --noproxy "*" -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1; then up="yes after ${i}s"; break; fi
      if ! kill -0 $pid 2>/dev/null; then code=0; wait $pid || code=$?; up="NO: process exited with code $code"; break; fi
      sleep 1
    done
    echo "  start $round: listening: $up; tables in public: $($SU -d "$db" -tAc "select count(*) from pg_tables where schemaname='public'")"
    if [ "$round" = 2 ] && [[ "$up" == yes* ]]; then
      node "$HERE/smoke.mjs" "http://127.0.0.1:$APP_PORT" | sed 's/^/    /'
    fi
    pkill -f "src/server.ts" 2>/dev/null || true; wait $pid 2>/dev/null || true; sleep 1
    grep -q "Only kysely adapter" "$log" && echo "  start $round: Better Auth migration error in log" || true
    # Смоук входит демо-аккаунтом: в одноразовой базе исправляется его хеш (ошибка db/sync.ts, аудит, раздел 8).
    [ "$round" = 1 ] && [ -n "$($SU -d "$db" -tAc "select to_regclass('public.ketner_users')")" ] && $SU -d "$db" -c "UPDATE ketner_users SET password_hash = 'bbc0bc01b2922db02e7e323650293f89d30adc22edf33a76811707cd06e54bc9' WHERE id = 'demo-user'"
  done
done
