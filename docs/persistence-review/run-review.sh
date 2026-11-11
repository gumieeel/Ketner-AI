#!/usr/bin/env bash
# Проверка предложения хранения на ОДНОРАЗОВОМ кластере Postgres 16 (не на базе проекта).
# Запуск из корня репозитория: bash docs/persistence-review/run-review.sh
# Нужны: /usr/lib/postgresql/16/bin, пользователь postgres, psql, npx tsx, node.
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DIR=/var/lib/postgresql/ketner-review
PORT=${PORT:-5433}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
WORK=$(mktemp -d)
SU="psql -X -h 127.0.0.1 -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"

su postgres -c "rm -rf $DIR && mkdir -p $DIR && $PGBIN/initdb -D $DIR/data -A trust -U postgres >/dev/null \
  && $PGBIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log start >/dev/null"
trap 'su postgres -c "$PGBIN/pg_ctl -D $DIR/data stop -m fast >/dev/null"; rm -rf "$WORK"' EXIT

echo "== Postgres: $($SU -tAc 'select version()' | cut -d' ' -f1-2)"
# Роли как в Supabase + роли сервера Ketner.
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
SQL
done

BACK="psql -X -h 127.0.0.1 -p $PORT -U ketner_backend -v ON_ERROR_STOP=1 -q"
MIGRATE() { (cd "$ROOT/apps/mock-api" && npx tsx "$HERE/apply-migrations.mts" "postgres://ketner_backend@127.0.0.1:$PORT/$1"); }
PROPOSAL() { $BACK -d "$1" -1 -f "$ROOT/docs/PERSISTENCE_MIGRATIONS_PROPOSAL.sql" -f "$HERE/record-proposal.sql"; }

echo "== 1. Existing migrations 0001-0012, existing data, proposal (role ketner_backend)"
MIGRATE review
$BACK -d review -f "$HERE/seed-existing.sql"
PROPOSAL review
echo "proposal applied in one transaction (with runner records 0013-0017)"

echo "== 2. Isolation, authorization, idempotency, deletion (role ketner_backend)"
$BACK -d review -f "$HERE/isolation-check.sql"

echo "== 3. Revocation during an active execution (two connections, role ketner_backend)"
node "$HERE/revocation-race.mjs" "postgres://ketner_backend@127.0.0.1:$PORT/review" || echo "revocation-race: FAILURES"

echo "== 4. RLS by role (superuser switches roles)"
$SU -d review -f "$HERE/rls-roles.sql"

echo "== 5a. Concurrent duplicates and charges (role ketner_backend)"
node "$HERE/idempotency-race.mjs" "postgres://ketner_backend@127.0.0.1:$PORT/review" || echo "idempotency-race: FAILURES"

echo "== 5b. Safe retries: dispatch phases, failures, unknown outcomes, reconciliation, races (role ketner_backend)"
node "$HERE/effect-retry.mjs" "postgres://ketner_backend@127.0.0.1:$PORT/review" || echo "effect-retry: FAILURES"

echo "== 6. Full rollback on a separate database: full state before proposal vs after rollback"
MIGRATE rollback_check
$BACK -d rollback_check -f "$HERE/seed-existing.sql"
CAT="psql -X -h 127.0.0.1 -p $PORT -U postgres -d rollback_check -q -f $HERE/catalog-snapshot.sql"
SNAP="psql -X -h 127.0.0.1 -p $PORT -U ketner_backend -d rollback_check -q -tA -f $HERE/state-snapshot.sql"
DUMP="$PGBIN/pg_dump -h 127.0.0.1 -p $PORT -U postgres --schema-only rollback_check"
$CAT > "$WORK/catalog-before.txt"; $SNAP > "$WORK/data-before.txt"; $DUMP > "$WORK/dump-before.sql"
PROPOSAL rollback_check
$CAT > "$WORK/catalog-proposal.txt"
echo "catalog objects: before=$(wc -l < "$WORK/catalog-before.txt") with proposal=$(wc -l < "$WORK/catalog-proposal.txt")"
$BACK -d rollback_check -f "$ROOT/docs/PERSISTENCE_MIGRATIONS_ROLLBACK.sql"
$CAT > "$WORK/catalog-after.txt"; $SNAP > "$WORK/data-after.txt"; $DUMP > "$WORK/dump-after.sql"
echo "catalog objects after rollback=$(wc -l < "$WORK/catalog-after.txt")"
echo "-- catalog diff (before vs after rollback):"
diff "$WORK/catalog-before.txt" "$WORK/catalog-after.txt" && echo "catalog: IDENTICAL" || echo "catalog: DIFFERS (lines above)"
echo "-- data diff (row count + md5 of every table, including schema_migrations):"
diff "$WORK/data-before.txt" "$WORK/data-after.txt" && echo "data: IDENTICAL ($(wc -l < "$WORK/data-before.txt") tables)" || echo "data: DIFFERS (lines above)"
echo "-- raw pg_dump --schema-only diff (unfiltered):"
diff "$WORK/dump-before.sql" "$WORK/dump-after.sql" && echo "pg_dump raw: IDENTICAL" || echo "pg_dump raw: DIFFERS (lines above)"
echo "-- pg_dump diff without \\restrict/\\unrestrict token lines:"
diff <(grep -Ev '^\\(un)?restrict ' "$WORK/dump-before.sql") <(grep -Ev '^\\(un)?restrict ' "$WORK/dump-after.sql") \
  && echo "pg_dump filtered: IDENTICAL" || echo "pg_dump filtered: DIFFERS (lines above)"
PROPOSAL rollback_check
echo "rollback: proposal re-applies cleanly after rollback"

echo "== 7. Project test suite against real Postgres (role ketner_backend)"
(cd "$ROOT/apps/mock-api" && TEST_DATABASE_URL="postgres://ketner_backend@127.0.0.1:$PORT/project_tests" npm test 2>&1 \
  | grep -E '^# (tests|pass|fail|skipped|cancelled)|^not ok|# SKIP')
