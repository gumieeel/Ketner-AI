/**
 * Запись пользователей в ketner_users на настоящем Postgres: оба INSERT (драйвер userStore и перенос
 * локальных пользователей при старте) выполняются по-настоящему. С 8df00ad до этого исправления в
 * списке колонок не было закрывающей кавычки ("updated_at, "signup_method") — синтаксическая
 * ошибка, которая только писалась в лог. Без TEST_DATABASE_URL тест пропускается (в CI он есть).
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import postgres from 'postgres';
import { createUserStore, type StoredUser } from '../store/user-store.js';
import { createUserDbDriver, ensureDatabaseSchema, loadAndSyncUsers } from './sync.js';

async function withDatabase(
  t: test.TestContext,
  body: (sql: postgres.Sql) => Promise<void>,
): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    t.skip('нет TEST_DATABASE_URL');
    return;
  }
  const admin = postgres(url, { onnotice: () => {}, max: 1 });
  const schema = `t_users_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  await admin.unsafe(`CREATE SCHEMA ${schema}`);
  const sql = postgres(url, { onnotice: () => {}, max: 2, connection: { search_path: schema } });
  try {
    await ensureDatabaseSchema(sql);
    await body(sql);
  } finally {
    await sql.end();
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

const tempStore = () =>
  createUserStore(join(mkdtempSync(join(tmpdir(), 'ketner-users-')), 'u.json'));

type Row = Record<string, unknown>;
const rowOf = async (sql: postgres.Sql, email: string): Promise<Row | undefined> =>
  (
    await sql<Row[]>`
      SELECT id, email, name, plan, is_vip, is_admin, telegram_chat_id, telegram_username,
             signup_method, signup_attribution, password_hash <> '' AS has_password,
             created_at IS NOT NULL AS has_created, updated_at IS NOT NULL AS has_updated
      FROM "ketner_users" WHERE email = ${email}`
  )[0];

test('ketner_users: новый пользователь записывается драйвером, обновления находят строку', async (t) => {
  await withDatabase(t, async (sql) => {
    const driver = createUserDbDriver(sql);
    const store = tempStore();
    const created = store.create('new.user@example.com', 'password-123456', 'Новый', {
      method: 'google',
      attribution: { source: 'utm', utmSource: 'newsletter' } as never,
    });
    const stored = store.getAllStoredUsers!().find((u) => u.id === created.id)!;

    // Ошибка SQL здесь — отказ промиса и падение теста, а не строка в логе.
    await driver.onUserCreated!({ ...stored });
    assert.deepEqual(await rowOf(sql, 'new.user@example.com'), {
      id: created.id,
      email: 'new.user@example.com',
      name: 'Новый',
      plan: 'free',
      is_vip: false,
      is_admin: false,
      telegram_chat_id: null,
      telegram_username: null,
      signup_method: 'google',
      signup_attribution: { source: 'utm', utmSource: 'newsletter' },
      has_password: true,
      has_created: true,
      has_updated: true,
    });

    // Повтор (ON CONFLICT … DO UPDATE) и все обновления меняют ровно эту строку.
    await driver.onUserCreated!({ ...stored, name: 'Новое имя' });
    await driver.onPlanUpdated!(created.id, 'pro');
    await driver.onVipUpdated!(created.id, true);
    await driver.onAdminUpdated!(created.id, true);
    await driver.onTelegramUpdated!(created.id, 7001, 'new_user');
    await driver.onPasswordUpdated!(created.id, 'salt-2', 'hash-2');
    const updated = await rowOf(sql, 'new.user@example.com');
    assert.deepEqual(
      [
        updated?.name,
        updated?.plan,
        updated?.is_vip,
        updated?.is_admin,
        updated?.telegram_chat_id,
        updated?.telegram_username,
      ],
      ['Новое имя', 'pro', true, true, '7001', 'new_user'],
    );
    const [password] = await sql<{ salt: string; password_hash: string }[]>`
      SELECT salt, password_hash FROM "ketner_users" WHERE id = ${created.id}`;
    assert.deepEqual({ ...password }, { salt: 'salt-2', password_hash: 'hash-2' });
    const [{ count }] = await sql<{ count: string }[]>`SELECT count(*) FROM "ketner_users"`;
    assert.equal(Number(count), 1);
  });
});

test('ketner_users: создание через userStore с драйвером доходит до базы', async (t) => {
  await withDatabase(t, async (sql) => {
    const store = tempStore();
    store.setDbDriver!(createUserDbDriver(sql));
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const user = store.create('via.store@example.com', 'password-123456', 'Через хранилище', {
        method: 'email',
      });
      // Драйвер вызывается без ожидания (как в production): ждём строку.
      for (let i = 0; i < 50 && !(await rowOf(sql, 'via.store@example.com')); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal((await rowOf(sql, 'via.store@example.com'))?.id, user.id);
      assert.deepEqual(errors, [], 'ошибок записи в лог нет');
    } finally {
      console.error = original;
    }
  });
});

test('ketner_users: локальный пользователь, которого нет в базе, переносится при старте', async (t) => {
  await withDatabase(t, async (sql) => {
    const local = tempStore();
    const created = local.create('local.only@example.com', 'password-123456', 'Локальный', {
      method: 'email',
      attribution: { source: 'direct' } as never,
    });
    local.linkTelegram(created.id, 7002, 'local_only');
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      await loadAndSyncUsers(sql, local);
    } finally {
      console.error = original;
    }
    assert.deepEqual(errors, [], 'перенос без ошибок в логе');
    const row = await rowOf(sql, 'local.only@example.com');
    assert.equal(row?.id, created.id, 'id сохраняется — данные пользователя остаются его');
    assert.equal(row?.signup_method, 'email');
    assert.deepEqual(row?.signup_attribution, { source: 'direct' });
    assert.equal(row?.telegram_chat_id, '7002');

    // Второй старт: пользователь уже в базе, повторного переноса нет, в памяти он остаётся.
    const restarted = tempStore();
    await loadAndSyncUsers(sql, restarted);
    const loaded: StoredUser | undefined = restarted.getAllStoredUsers!().find(
      (u) => u.email === 'local.only@example.com',
    );
    assert.equal(loaded?.id, created.id);
    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*) FROM "ketner_users" WHERE email = 'local.only@example.com'`;
    assert.equal(Number(count), 1);
  });
});
