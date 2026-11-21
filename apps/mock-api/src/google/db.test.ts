import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../db/migrate.js';
import { MIGRATIONS } from '../db/migration-list.js';
import { openTestSql } from '../testing/sql.js';
import { DRIVE_FILE, USERINFO_EMAIL, createFakeGoogle } from '../testing/fake-google.js';
import { parseEraseAccountArgs, runEraseAccount } from '../scripts/erase-account.js';
import { createGoogleConnectionStore } from './connection-store.js';
import { attachGoogleStores } from './db.js';
import { GOOGLE_OAUTH_NAMESPACE, createGoogleVerifierStore } from './verifier-store.js';

const SECRET = 'db-test-secret';

async function openDb(t: test.TestContext) {
  const sql = await openTestSql();
  if (!sql) {
    t.skip('нет PGlite и TEST_DATABASE_URL');
    return null;
  }
  t.after(() => sql.close());
  await runMigrations(sql.db, MIGRATIONS);
  // ketner_docs создаёт db/sync.ts при старте сервера; в тестовой схеме — сами.
  await sql.runner.query(`CREATE TABLE IF NOT EXISTS ketner_docs (
    namespace text NOT NULL, id text NOT NULL, data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (namespace, id))`);
  return sql;
}

async function attached(runner: Parameters<typeof attachGoogleStores>[0]) {
  const connections = createGoogleConnectionStore({ secret: SECRET });
  const verifiers = createGoogleVerifierStore();
  await attachGoogleStores(runner, { connections, verifiers });
  return { connections, verifiers };
}

test('google_connections: запись, отключение и чтение после перезапуска; CHECK таблицы проходят', async (t) => {
  const sql = await openDb(t);
  if (!sql) return;
  const first = await attached(sql.runner);
  await first.connections.connect({
    userId: 'u1',
    googleSub: 'sub-1',
    googleEmail: 'owner@example.com',
    scopes: ['openid', USERINFO_EMAIL, DRIVE_FILE],
    refreshToken: '1//refresh-db',
    spreadsheet: { id: 'sheet-AbCdEfGhIjKl', url: 'https://docs.google.com/spreadsheets/d/x/edit' },
  });
  await first.connections.connect({
    userId: 'u2',
    googleSub: 'sub-2',
    googleEmail: null,
    scopes: [DRIVE_FILE],
    refreshToken: '1//refresh-2',
    spreadsheet: null,
    sheetErrorCode: 'quota',
  });

  const rows = await sql.runner.query<{
    user_id: string;
    refresh_token_enc: string;
    scopes: string;
    status: string;
  }>('SELECT user_id, refresh_token_enc, scopes, status FROM google_connections ORDER BY user_id');
  assert.equal(rows.length, 2);
  assert.match(rows[0]!.refresh_token_enc, /^v1\./);
  assert.ok(!rows[0]!.refresh_token_enc.includes('refresh-db'), 'в базе только шифр');
  assert.equal(rows[0]!.scopes, `openid ${USERINFO_EMAIL} ${DRIVE_FILE}`);
  assert.deepEqual(
    rows.map((row) => row.status),
    ['connected', 'sheet_missing'],
  );

  // «Перезапуск»: новое хранилище читает из базы и расшифровывает тем же ключом.
  const second = await attached(sql.runner);
  assert.equal(second.connections.refreshTokenOf('u1'), '1//refresh-db');
  assert.deepEqual(second.connections.get('u1'), first.connections.get('u1'));
  assert.equal(second.connections.get('u2')?.lastErrorCode, 'quota');

  await second.connections.disconnect('u1');
  const [disconnected] = await sql.runner.query<{
    status: string;
    refresh_token_enc: string | null;
  }>("SELECT status, refresh_token_enc FROM google_connections WHERE user_id = 'u1'");
  assert.deepEqual(disconnected, { status: 'disconnected', refresh_token_enc: null });

  // Сбой базы — исключение, в памяти прежнее состояние.
  await assert.rejects(() =>
    second.connections.connect({
      userId: 'u3',
      googleSub: 'sub-3',
      googleEmail: null,
      scopes: ['openid'], // без drive.file — CHECK google_connections_drive_file
      refreshToken: 'x',
      spreadsheet: null,
    }),
  );
  assert.equal(second.connections.get('u3'), undefined);
});

test('verifier в ketner_docs: переживает перезапуск, одноразовый', async (t) => {
  const sql = await openDb(t);
  if (!sql) return;
  const first = await attached(sql.runner);
  await first.verifiers.put({
    id: 'nonce-1',
    userId: 'u1',
    verifier: 'v-1',
    expiresAt: Date.now() + 60_000,
  });
  const second = await attached(sql.runner);
  assert.equal(second.verifiers.take('nonce-1', 'u1'), 'v-1');
  // Удаление из базы идёт в фоне — ждём его.
  for (let i = 0; i < 50; i += 1) {
    const left = await sql.runner.query('SELECT id FROM ketner_docs WHERE namespace = $1', [
      GOOGLE_OAUTH_NAMESPACE,
    ]);
    if (left.length === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const third = await attached(sql.runner);
  assert.equal(third.verifiers.take('nonce-1', 'u1'), undefined);
});

test('скрипт удаления: по умолчанию сводка без изменений; --confirm — отзыв и удаление', async (t) => {
  const sql = await openDb(t);
  if (!sql) return;
  const seed = await attached(sql.runner);
  await seed.connections.connect({
    userId: 'u-erase',
    googleSub: 'sub-e',
    googleEmail: 'e@example.com',
    scopes: [DRIVE_FILE],
    refreshToken: '1//erase-me',
    spreadsheet: { id: 'sheet-AbCdEfGhIjKl', url: 'https://docs.google.com/spreadsheets/d/e/edit' },
  });
  await seed.verifiers.put({
    id: 'n-e',
    userId: 'u-erase',
    verifier: 'v',
    expiresAt: Date.now() + 60_000,
  });
  const google = createFakeGoogle();

  assert.deepEqual(parseEraseAccountArgs(['--user', 'u-erase']), {
    userId: 'u-erase',
    confirm: false,
  });
  assert.deepEqual(parseEraseAccountArgs(['--user=u-erase', '--confirm']), {
    userId: 'u-erase',
    confirm: true,
  });
  assert.equal(typeof parseEraseAccountArgs([]), 'string');
  assert.equal(typeof parseEraseAccountArgs(['--user', 'u', '--force']), 'string');

  const dry = await runEraseAccount(
    { userId: 'u-erase', confirm: false },
    { sql: sql.runner, secret: SECRET, fetchImpl: google.fetchImpl, log: () => {} },
  );
  assert.equal(dry.report.dryRun, true);
  assert.match(dry.text, /Проверка \(ничего не удалено\)/);
  assert.match(dry.text, /строка google_connections: 1/);
  assert.match(dry.text, /отзыв доступа Google: 1/);
  assert.match(dry.text, /Ещё без очистки в реестре/);
  assert.match(dry.text, /bot_leads/);
  assert.match(dry.text, /добавьте --confirm/);
  assert.ok(!dry.text.includes('erase-me'), 'токен не печатается');
  assert.deepEqual(google.revoked, []);
  assert.equal(
    (await sql.runner.query("SELECT 1 FROM google_connections WHERE user_id = 'u-erase'")).length,
    1,
  );

  const done = await runEraseAccount(
    { userId: 'u-erase', confirm: true },
    { sql: sql.runner, secret: SECRET, fetchImpl: google.fetchImpl, log: () => {} },
  );
  assert.equal(done.report.complete, true);
  assert.match(done.text, /Удалено у аккаунта u-erase/);
  assert.deepEqual(google.revoked, ['1//erase-me']);
  assert.equal(
    (await sql.runner.query("SELECT 1 FROM google_connections WHERE user_id = 'u-erase'")).length,
    0,
  );
  assert.equal(
    (
      await sql.runner.query('SELECT 1 FROM ketner_docs WHERE namespace = $1', [
        GOOGLE_OAUTH_NAMESPACE,
      ])
    ).length,
    0,
  );
});
