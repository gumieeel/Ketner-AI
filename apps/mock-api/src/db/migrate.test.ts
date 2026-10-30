import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MigrationChecksumError,
  migrationChecksum,
  runMigrations,
  validateMigrationList,
  type Migration,
  type MigrationDb,
  type MigrationQuery,
} from './migrate.js';
import { MIGRATIONS } from './migration-list.js';

/**
 * Поддельная база: помнит таблицу schema_migrations и выполненные миграции. Транзакция откатывает
 * свои записи при ошибке — как в Postgres.
 */
function fakeDb(options: { failOn?: string } = {}) {
  const recorded = new Map<string, string>();
  const executed: string[] = [];
  const run = (pending: Map<string, string>, pendingExec: string[]): MigrationQuery => ({
    async query<T>(text: string, params: unknown[] = []): Promise<T[]> {
      if (text.startsWith('SELECT pg_advisory_xact_lock')) return [];
      if (text.startsWith('SELECT "checksum"')) {
        const checksum = pending.get(String(params[0])) ?? recorded.get(String(params[0]));
        return (checksum ? [{ checksum }] : []) as T[];
      }
      if (text.startsWith('INSERT INTO "schema_migrations"')) {
        pending.set(String(params[0]), String(params[1]));
        return [];
      }
      if (options.failOn && text.includes(options.failOn)) throw new Error('syntax error');
      pendingExec.push(text.trim());
      return [];
    },
  });
  const db: MigrationDb = {
    query: (text, params) => run(recorded, executed).query(text, params),
    async transaction(body) {
      const pending = new Map<string, string>();
      const pendingExec: string[] = [];
      const value = await body(run(pending, pendingExec));
      for (const [id, checksum] of pending) recorded.set(id, checksum);
      executed.push(...pendingExec);
      return value;
    },
  };
  return { db, recorded, executed };
}

const list: Migration[] = [
  { id: '0001_first', sql: 'CREATE TABLE a (id text)' },
  { id: '0002_second', sql: 'CREATE TABLE b (id text); CREATE INDEX b_idx ON b (id)' },
];

test('миграции применяются по порядку, повторный запуск ничего не делает', async () => {
  const { db, recorded, executed } = fakeDb();
  const first = await runMigrations(db, list);
  assert.deepEqual(first.applied, ['0001_first', '0002_second']);
  assert.ok(
    executed.some((sql) => sql.startsWith('CREATE TABLE IF NOT EXISTS "schema_migrations"')),
  );
  assert.equal(recorded.get('0001_first'), migrationChecksum(list[0]));

  const before = executed.length;
  const second = await runMigrations(db, list);
  assert.deepEqual(second.applied, []);
  assert.deepEqual(second.alreadyApplied, ['0001_first', '0002_second']);
  // Второй раз выполняется только CREATE TABLE IF NOT EXISTS schema_migrations.
  assert.equal(executed.length, before + 1);
});

test('новая миграция в конце списка применяется одна', async () => {
  const { db } = fakeDb();
  await runMigrations(db, list.slice(0, 1));
  const result = await runMigrations(db, list);
  assert.deepEqual(result.applied, ['0002_second']);
});

test('изменённая применённая миграция останавливает раннер, следующие не применяются', async () => {
  const { db, recorded } = fakeDb();
  await runMigrations(db, list.slice(0, 1));
  const changed: Migration[] = [
    { id: '0001_first', sql: 'CREATE TABLE a (id text, x int)' },
    list[1],
  ];
  await assert.rejects(runMigrations(db, changed), MigrationChecksumError);
  assert.equal(recorded.has('0002_second'), false);
});

test('упавшая миграция не отмечается применённой и прерывает список', async () => {
  const { db, recorded } = fakeDb({ failOn: 'CREATE TABLE b' });
  await assert.rejects(runMigrations(db, list), /syntax error/);
  assert.equal(recorded.has('0001_first'), true);
  assert.equal(recorded.has('0002_second'), false);
});

test('список миграций проверяется: формат id, порядок, пустой SQL', () => {
  assert.throws(() => validateMigrationList([{ id: '1_bad', sql: 'x' }]), /NNNN_имя/);
  assert.throws(
    () =>
      validateMigrationList([
        { id: '0002_b', sql: 'x' },
        { id: '0001_a', sql: 'y' },
      ]),
    /не по порядку/,
  );
  assert.throws(
    () =>
      validateMigrationList([
        { id: '0001_a', sql: 'x' },
        { id: '0001_a', sql: 'y' },
      ]),
    /не по порядку/,
  );
  assert.throws(() => validateMigrationList([{ id: '0001_a', sql: '  ' }]), /пустая/);
  // Настоящий список проекта корректен.
  validateMigrationList(MIGRATIONS);
});
