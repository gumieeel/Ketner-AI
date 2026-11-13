#!/usr/bin/env bash
# Проверка Slice A (docs/PERSISTENCE_SLICE_A.sql) на ОДНОРАЗОВОМ кластере Postgres (не на базе проекта).
# Модель production: роль сервера — владелец таблиц, права по умолчанию Supabase на таблицы и функции,
# событийный триггер rls_auto_enable. Запуск из корня репозитория:
#   bash docs/persistence-review/slice-a/run-review-slice-a.sh            (PGBIN — каталог bin Postgres, по умолчанию 16)
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DIR=/var/lib/postgresql/ketner-slice-a
PORT=${PORT:-5442}
HERE=$(cd "$(dirname "$0")" && pwd)
REVIEW=$(cd "$HERE/.." && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
SLICE="$ROOT/docs/PERSISTENCE_SLICE_A.sql"
ROLLBACK="$ROOT/docs/PERSISTENCE_SLICE_A_ROLLBACK.sql"
WORK=$(mktemp -d)
SU="psql -X -h 127.0.0.1 -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
BACK="psql -X -h 127.0.0.1 -p $PORT -U ketner_backend -v ON_ERROR_STOP=1 -q"
URL() { echo "postgres://ketner_backend@127.0.0.1:$PORT/$1"; }

cp -a "$ROOT/apps/mock-api/data" "$WORK/data-backup" 2>/dev/null || true
cleanup() {
  su postgres -c "$PGBIN/pg_ctl -D $DIR/data stop -m fast >/dev/null" || true
  if [ -d "$WORK/data-backup" ]; then rm -rf "$ROOT/apps/mock-api/data" && cp -a "$WORK/data-backup" "$ROOT/apps/mock-api/data"; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

su postgres -c "rm -rf $DIR && mkdir -p $DIR && $PGBIN/initdb -D $DIR/data -A trust -U postgres >/dev/null \
  && $PGBIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log start >/dev/null"
echo "== Postgres: $($SU -tAc 'select version()' | cut -d' ' -f1-2)"
$SU <<'SQL'
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE authenticator LOGIN NOINHERIT;
GRANT anon, authenticated, service_role TO authenticator;
CREATE ROLE ketner_backend LOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE ketner_backend_bypass LOGIN NOSUPERUSER BYPASSRLS;
CREATE ROLE ketner_restricted LOGIN NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE review OWNER ketner_backend;
CREATE DATABASE rollback_check OWNER ketner_backend;
CREATE DATABASE project_tests OWNER ketner_backend;
SQL
for db in review rollback_check; do
  $SU -d $db <<'SQL'
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, ketner_backend_bypass, ketner_restricted;
ALTER SCHEMA public OWNER TO ketner_backend;
ALTER DEFAULT PRIVILEGES FOR ROLE ketner_backend IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role, ketner_backend_bypass, ketner_restricted;
ALTER DEFAULT PRIVILEGES FOR ROLE ketner_backend IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
SQL
  $SU -d $db -f "$ROOT/docs/security-review/rls-auto-enable-model.sql"
done

MIGRATE() { (cd "$ROOT/apps/mock-api" && npx tsx "$REVIEW/apply-migrations.mts" "$(URL "$1")" 0012_implementation_pricing); }
APPLY() { $BACK -d "$1" -1 -f "$SLICE" -f "$HERE/record-slice-a.sql"; }

echo "== 1. Existing migrations 0001-0012 (real runner), existing data, Slice A (one transaction)"
MIGRATE review
$BACK -d review -f "$REVIEW/seed-existing.sql"
APPLY review
echo "Slice A applied; new tables: $($SU -d review -tAc "select string_agg(tablename, ', ' order by tablename) from pg_tables where schemaname='public' and tablename in ('solution_version_specs','agent_deployments','executions','execution_events','execution_effects')")"

echo "== 2. Existing data, isolation, secrets tripwire, bot scenario, deletion, immutability"
$BACK -d review -f "$HERE/isolation-check-a.sql"

echo "== 3. Secret rules: code (platform/secrets.ts) and database (platform_contains_secret) agree"
(cd "$ROOT/apps/mock-api" && npx tsx "$HERE/secret-parity.mts" "$(URL review)") | tail -1

echo "== 4. RLS by role"
$SU -d review -f "$HERE/rls-roles-a.sql" 2>&1 | grep -v NOTICE

echo "== 4b. Function privileges: only the owner (server) can execute"
$SU -d review -f "$REVIEW/function-privileges.sql" | tail -1

echo "== 5a. Concurrent duplicates (role ketner_backend)"
node "$REVIEW/idempotency-race.mjs" "$(URL review)" | tail -1

echo "== 5b. Safe retries: two-phase effects, failures, unknown outcomes, races (role ketner_backend)"
node "$REVIEW/effect-retry.mjs" "$(URL review)" | tail -1

echo "== 6. Rollback on a separate database: full state before Slice A vs after rollback"
MIGRATE rollback_check
$BACK -d rollback_check -f "$REVIEW/seed-existing.sql"
CAT="psql -X -h 127.0.0.1 -p $PORT -U postgres -d rollback_check -q -f $REVIEW/catalog-snapshot.sql"
SNAP="psql -X -h 127.0.0.1 -p $PORT -U ketner_backend -d rollback_check -q -tA -f $REVIEW/state-snapshot.sql"
DUMP="$PGBIN/pg_dump -h 127.0.0.1 -p $PORT -U postgres --schema-only rollback_check"
$CAT > "$WORK/catalog-before.txt"; $SNAP > "$WORK/data-before.txt"; $DUMP | grep -Ev '^\\(un)?restrict ' > "$WORK/dump-before.sql"
APPLY rollback_check
echo "catalog objects: before=$(wc -l < "$WORK/catalog-before.txt") with Slice A=$($CAT | wc -l)"
$BACK -d rollback_check -f "$ROLLBACK"
$CAT > "$WORK/catalog-after.txt"; $SNAP > "$WORK/data-after.txt"; $DUMP | grep -Ev '^\\(un)?restrict ' > "$WORK/dump-after.sql"
diff "$WORK/catalog-before.txt" "$WORK/catalog-after.txt" && echo "catalog: IDENTICAL" || echo "catalog: DIFFERS (lines above)"
diff "$WORK/data-before.txt" "$WORK/data-after.txt" && echo "data: IDENTICAL ($(wc -l < "$WORK/data-before.txt") tables)" || echo "data: DIFFERS"
diff "$WORK/dump-before.sql" "$WORK/dump-after.sql" && echo "pg_dump --schema-only (without \\restrict token): IDENTICAL" || echo "pg_dump: DIFFERS"
APPLY rollback_check && echo "Slice A re-applies cleanly after rollback"

echo "== 7. Server test suite against real Postgres (role ketner_backend)"
(cd "$ROOT/apps/mock-api" && TEST_DATABASE_URL="$(URL project_tests)" npm test 2>&1 \
  | grep -E '^# (tests|pass|fail|skipped|cancelled)|^not ok|# SKIP')
