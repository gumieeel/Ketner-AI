#!/usr/bin/env bash
# Проверка docs/SECURITY_REMEDIATION_PROPOSAL.sql на ОДНОРАЗОВОМ кластере Postgres 16 (не на базе проекта).
# Модель production (проверено владельцем 2026-11-11, docs/SECURITY_PRIVILEGE_AUDIT.md):
#   - сервер = роль-владелец таблиц, не суперпользователь, BYPASSRLS (в Supabase — postgres; здесь ketner_backend);
#   - RLS включён на всех таблицах public, FORCE выключен;
#   - права по умолчанию как в Supabase: всё на новые таблицы, последовательности и функции public
#     ролям anon, authenticated, service_role.
# Таблицы создаёт настоящий сервер Ketner (db/sync.ts и миграции 0001–0012).
# Запуск из корня репозитория: bash docs/security-review/run-security-review.sh
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DIR=/var/lib/postgresql/ketner-security
PG_PORT=${PG_PORT:-5434}
APP_PORT=${APP_PORT:-8899}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
API="$ROOT/apps/mock-api"
WORK=$(mktemp -d)
H="-X -h 127.0.0.1 -p $PG_PORT"
C="-h 127.0.0.1 -p $PG_PORT"   # для pg_dump/pg_restore (без -X)
SU="psql $H -U postgres -v ON_ERROR_STOP=1 -q"
BACK="psql $H -U ketner_backend -v ON_ERROR_STOP=1 -q"
PROPOSAL="$ROOT/docs/SECURITY_REMEDIATION_PROPOSAL.sql"
ROLLBACK="$ROOT/docs/SECURITY_REMEDIATION_ROLLBACK.sql"
SERVER_PID=""

# Сервер пишет локальные файлы в apps/mock-api/data — сохраняем и возвращаем их как были.
cp -a "$API/data" "$WORK/data-backup" 2>/dev/null || true
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  pkill -f "src/server.ts" 2>/dev/null || true
  su postgres -c "$PGBIN/pg_ctl -D $DIR/data stop -m fast >/dev/null" || true
  if [ -d "$WORK/data-backup" ]; then rm -rf "$API/data" && cp -a "$WORK/data-backup" "$API/data"; fi
  if [ -n "${KEEP_LOGS:-}" ]; then mkdir -p "$KEEP_LOGS/security-review-logs" && cp "$WORK"/*.log "$WORK"/*.txt "$KEEP_LOGS/security-review-logs/" 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

su postgres -c "rm -rf $DIR && mkdir -p $DIR && $PGBIN/initdb -D $DIR/data -A trust -U postgres >/dev/null \
  && $PGBIN/pg_ctl -D $DIR/data -o '-p $PG_PORT -k $DIR' -l $DIR/log start >/dev/null"
echo "== Postgres: $($SU -tAc 'select version()' | cut -d' ' -f1-2)"

$SU <<'SQL'
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE authenticator LOGIN NOINHERIT;
GRANT anon, authenticated, service_role TO authenticator;
CREATE ROLE ketner_backend LOGIN NOSUPERUSER BYPASSRLS;       -- как postgres в Supabase: владелец таблиц, BYPASSRLS
CREATE ROLE ketner_restricted LOGIN NOSUPERUSER NOBYPASSRLS;  -- не владелец: на нём проверяется отказ скрипта
CREATE DATABASE app OWNER ketner_backend;
CREATE DATABASE tests OWNER ketner_backend;
SQL
for db in app tests; do
  $SU -d $db <<'SQL'
ALTER SCHEMA public OWNER TO ketner_backend;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, ketner_restricted;
ALTER DEFAULT PRIVILEGES FOR ROLE ketner_backend IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE ketner_backend IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE ketner_backend IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
SQL
done

start_server() {  # $1 — метка лога, $2 — база
  (cd "$API" && DATABASE_URL="postgres://ketner_backend@127.0.0.1:$PG_PORT/$2" NODE_ENV=development PORT=$APP_PORT \
     node --no-experimental-sqlite --import tsx src/server.ts > "$WORK/server-$1.log" 2>&1) &
  SERVER_PID=$!
  for _ in $(seq 1 90); do
    curl --noproxy "*" -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1 && break
    sleep 1
  done
  sleep 3
}
stop_server() {
  kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; SERVER_PID=""
  pkill -f "src/server.ts" 2>/dev/null || true; sleep 1
}
server_errors() {
  grep -iE 'error|permission denied|42501|insufficient' "$WORK/server-$1.log" \
    | grep -viE 'ANTHROPIC|OPENAI|api key|ключ|STRIPE|DODO|TELEGRAM|SMTP|mail' | head -20 || true
}
enable_rls_everywhere() {  # модель production: RLS на всех таблицах public
  $SU -d "$1" -c "DO \$\$ DECLARE t text; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t); END LOOP; END \$\$"
}
CAT() { psql $H -U postgres -d "$1" -q -f "$ROOT/docs/persistence-review/catalog-snapshot.sql"; }
SNAP() { psql $H -U postgres -d "$1" -q -tA -f "$ROOT/docs/persistence-review/state-snapshot.sql"; }
DUMP() { "$PGBIN/pg_dump" $C -U postgres --schema-only "$1" | grep -Ev '^\\(un)?restrict '; }
MATRIX() { psql $H -U postgres -d "$1" -q -f "$HERE/privilege-matrix.sql"; }
PROBE() { psql $H -U postgres -d "$1" -q -f "$HERE/anon-probe.sql"; }
NORM="node $HERE/normalize-acl.mjs"
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; }

echo "== 1. Server creates tables (role ketner_backend); production model: RLS on every table; smoke"
# Два обхода ошибок, которые уже есть в main (код приложения не меняем, см. аудит, раздел 8):
#  - на Node >= 22.13 с DATABASE_URL Better Auth вызывает process.exit(1) в getMigrations — сервер
#    запускается с --no-experimental-sqlite (как на Node без node:sqlite);
#  - демо-пользователь, которого db/sync.ts пишет в Postgres, имеет хеш не от 'password123' —
#    в ОДНОРАЗОВОЙ базе хеш исправляется, чтобы смоук-тест мог войти.
start_server create app
stop_server
$SU -d app -c "UPDATE ketner_users SET password_hash = 'bbc0bc01b2922db02e7e323650293f89d30adc22edf33a76811707cd06e54bc9' WHERE id = 'demo-user'"
enable_rls_everywhere app
start_server before app
node "$HERE/smoke.mjs" "http://127.0.0.1:$APP_PORT" | sed 's/^/  /'
stop_server
echo "server log, suspicious lines:"; server_errors before | sed 's/^/  /'
# Копии для проверок отказа (базы-шаблоны копируют и права по умолчанию).

echo "== 2. Backup rehearsal: the production procedure (SECURITY_PRIVILEGE_AUDIT.md, 7) on the disposable database"
# Как на production: роль-владелец (не суперпользователь) экспортирует снимок; pg_dump и отпечаток данных
# берутся из ОДНОГО снимка, поэтому совпадают, даже если в базу пишут. Запись между ними — нарочно.
FP="$WORK/production-fingerprint.txt"
coproc SNAPSESSION { psql $H -U ketner_backend -d app -tA -q -v ON_ERROR_STOP=1; }
echo "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();" >&"${SNAPSESSION[1]}"
read -r SNAPSHOT <&"${SNAPSESSION[0]}"
$SU -d app -c "UPDATE ketner_users SET updated_at = now() + interval '1 second'"   # чужая запись после снимка
"$PGBIN/pg_dump" $C -U ketner_backend -d app --snapshot="$SNAPSHOT" -Fc -f "$WORK/app.dump"
printf '%s\n' "\\pset fieldsep '|'" "\\o $FP" "\\i $HERE/table-fingerprint.sql" "\\o" "COMMIT;" "\\q" >&"${SNAPSESSION[1]}"
wait "$SNAPSESSION_PID" 2>/dev/null || true
echo "fingerprint taken in the dump's snapshot: $(grep -vc '^$' "$FP") tables"
VERIFY_PORT=$((PG_PORT + 2)) VERIFY_EXTRA_ROLES="ketner_backend ketner_restricted" PGBIN=$PGBIN bash "$HERE/verify-restore.sh" "$WORK/app.dump" "$FP" | sed 's/^/  /'
now=$(psql $H -U postgres -d app -tA -F'|' -f "$HERE/table-fingerprint.sql")
diff <(grep -v '^$' "$FP") <(echo "$now" | grep -v '^$') >/dev/null \
  && fail "live database equals the snapshot (the concurrent write was not seen?)" \
  || pass "live database already differs (concurrent write), the dump and its fingerprint still match each other"

# Копии для проверок отказа (базы-шаблоны копируют и права по умолчанию).
$SU -c "CREATE DATABASE guard TEMPLATE app OWNER ketner_backend"
$SU -c "CREATE DATABASE globaldef TEMPLATE app OWNER ketner_backend"

echo "== 3. Before remediation (production model)"
MATRIX app > "$WORK/matrix-before.txt"
echo "tables: $(wc -l < "$WORK/matrix-before.txt"), RLS on: $(grep -c '|rls=true|' "$WORK/matrix-before.txt"), FORCE: $(grep -c '|force=true|' "$WORK/matrix-before.txt"), anon has privileges on: $(grep -vc '|anon=-|' "$WORK/matrix-before.txt")"
echo "anon/authenticated (RLS on, no policies): rows hidden, but TRUNCATE works:"; PROBE app | sed 's/^/  /'
CAT app > "$WORK/catalog-before.txt"; SNAP app > "$WORK/data-before.txt"; DUMP app > "$WORK/dump-before.sql"

echo "== 4. Apply remediation as ketner_backend (owner, not superuser), twice"
$BACK -d app -1 -f "$PROPOSAL"
$BACK -d app -1 -f "$PROPOSAL" 2>&1 | grep -v 'already exists, skipping' || true
echo "state rows recorded: $($SU -d app -tAc 'select count(*) from security_remediation_state') (second run kept the first run's record)"
MATRIX app > "$WORK/matrix-after.txt"
bad=$(grep -E '\|anon=[^-]|\|authenticated=[^-]' "$WORK/matrix-after.txt" || true)
[ -z "$bad" ] && pass "anon and authenticated have no privileges on any of $(wc -l < "$WORK/matrix-after.txt") tables" || { fail "still granted:"; echo "$bad"; }
strip() { sed -E 's/\|anon=[^|]*//; s/\|authenticated=[^|]*//' "$1"; }
diff <(strip "$WORK/matrix-before.txt") <(strip "$WORK/matrix-after.txt" | grep -v '^security_remediation_state|') \
  && pass "RLS, FORCE, owner and service_role privileges unchanged" || fail "RLS/owner/service_role changed (lines above)"
echo "anon/authenticated after remediation:"; PROBE app | sed 's/^/  /'
diff "$WORK/data-before.txt" <(SNAP app | grep -v '^security_remediation_state|') \
  && pass "application data unchanged" || fail "data changed (lines above)"
$BACK -d app -c "CREATE TABLE public.future_table (id int)"
r=$($SU -d app -tAc "select has_table_privilege('anon', 'public.future_table', 'SELECT') or has_table_privilege('authenticated', 'public.future_table', 'INSERT') or has_table_privilege('anon', 'public.future_table', 'TRUNCATE')")
[ "$r" = f ] && pass "a table created later by the owner gets no anon/authenticated privileges" || fail "new table still granted"
r=$($SU -d app -tAc "select has_table_privilege('service_role', 'public.future_table', 'SELECT')")
echo "  service_role on the new table: $r (default privileges for service_role untouched)"
$BACK -d app -c "DROP TABLE public.future_table"
echo "default privileges of ketner_backend in public now:"
$SU -d app -tAc "select defaclobjtype::text || ' ' || defaclacl::text from pg_default_acl where defaclrole = 'ketner_backend'::regrole order by 1" | sed 's/^/  /'

echo "== 5. Refusals (each must fail and change nothing)"
$SU -d guard -c "GRANT CREATE ON SCHEMA public TO ketner_restricted"
MATRIX guard > "$WORK/guard-before.txt"
out=$(psql $H -U ketner_restricted -d guard -v ON_ERROR_STOP=1 -q -1 -f "$PROPOSAL" 2>&1 || true)
echo "  non-owner role: $(echo "$out" | grep -o 'ERROR: .*' | head -1 | cut -c1-140)"
diff "$WORK/guard-before.txt" <(MATRIX guard) >/dev/null && pass "non-owner run refused, privileges unchanged" || fail "non-owner run changed something"
$SU -d globaldef -c "ALTER DEFAULT PRIVILEGES FOR ROLE ketner_backend GRANT ALL ON TABLES TO anon"
MATRIX globaldef > "$WORK/global-before.txt"
out=$($BACK -d globaldef -1 -f "$PROPOSAL" 2>&1 || true)
echo "  global default privileges: $(echo "$out" | grep -o 'ERROR: .*' | head -1 | cut -c1-160)"
diff "$WORK/global-before.txt" <(MATRIX globaldef) >/dev/null && [ -z "$($SU -d globaldef -tAc "select to_regclass('public.security_remediation_state')")" ] \
  && pass "global default privileges detected, whole transaction rolled back" || fail "partial change left behind"

echo "== 6. Server after remediation: startup (table checks, migrations) + smoke"
start_server after app
node "$HERE/smoke.mjs" "http://127.0.0.1:$APP_PORT" | sed 's/^/  /'
stop_server
echo "server log, suspicious lines:"; server_errors after | sed 's/^/  /'

echo "== 7. Rollback, compare with the state before remediation"
$BACK -d app -1 -f "$ROLLBACK"
CAT app > "$WORK/catalog-after.txt"; DUMP app > "$WORK/dump-after.sql"
echo "catalog raw: $(diff "$WORK/catalog-before.txt" "$WORK/catalog-after.txt" | grep -E '^[<>]' | grep -vc '^[<>] sequence ' || true) changed lines (sequence lines excluded)"
diff <($NORM < "$WORK/catalog-before.txt" | grep -v '^sequence ') <($NORM < "$WORK/catalog-after.txt" | grep -v '^sequence ') \
  && pass "catalog with ACL entries sorted: IDENTICAL (incl. default privileges)" || fail "catalog differs (lines above)"
diff "$WORK/matrix-before.txt" <(MATRIX app) >/dev/null && pass "privileges + RLS identical to before" || fail "privileges differ"
echo "pg_dump --schema-only: lines changed other than GRANT order: $(diff "$WORK/dump-before.sql" "$WORK/dump-after.sql" | grep -E '^[<>]' | grep -vc '^[<>] GRANT ' || true)"
diff <(sort "$WORK/dump-before.sql") <(sort "$WORK/dump-after.sql") >/dev/null && pass "pg_dump as a set of lines: IDENTICAL" || fail "pg_dump differs"
SNAP app > "$WORK/data-b2.txt"; MATRIX app > "$WORK/matrix-b2.txt"; CAT app | $NORM > "$WORK/catalog-b2.txt"
$BACK -d app -1 -f "$PROPOSAL" 2>/dev/null
$BACK -d app -1 -f "$ROLLBACK"
diff "$WORK/data-b2.txt" <(SNAP app) >/dev/null && pass "apply + rollback with no traffic in between: data IDENTICAL ($(wc -l < "$WORK/data-b2.txt") tables)" || fail "data differs"
diff "$WORK/catalog-b2.txt" <(CAT app | $NORM) >/dev/null && pass "apply + rollback: catalog IDENTICAL" || fail "catalog differs"
$BACK -d app -1 -f "$PROPOSAL" 2>/dev/null && pass "remediation re-applies cleanly after rollback"

echo "== 8. Full server test suite (role ketner_backend, database with remediation applied)"
start_server tests tests
stop_server
enable_rls_everywhere tests
$BACK -d tests -1 -f "$PROPOSAL"
echo "tests db: $($SU -d tests -tAc "select count(*) from pg_tables where schemaname='public' and rowsecurity") tables with RLS, anon-privileged: $($SU -d tests -tAc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and has_table_privilege('anon', c.oid, 'SELECT')")"
(cd "$API" && TEST_DATABASE_URL="postgres://ketner_backend@127.0.0.1:$PG_PORT/tests" npm test 2>&1 \
  | grep -E '^# (tests|pass|fail|skipped|cancelled)|^not ok|# SKIP')
