import assert from 'node:assert/strict';
import test from 'node:test';
import { createBetterAuth, initAuthDatabase } from './better-auth.js';

// Регрессия: на Node >= 22.13 модуль node:sqlite доступен без флага, и initAuthDatabase вызывал
// миграции Better Auth для экземпляра на Postgres (адаптер drizzle). Better Auth в getMigrations для
// адаптера без Kysely вызывает process.exit(1) — сервер с DATABASE_URL завершался до listen.
test('initAuthDatabase не завершает процесс для экземпляра Better Auth на Postgres', async (t) => {
  let sqliteAvailable = true;
  try {
    await import('node:sqlite' as string);
  } catch {
    sqliteAvailable = false;
  }
  if (!sqliteAvailable) {
    t.skip(`node:sqlite недоступен в Node ${process.version}: условие ошибки не воспроизводится`);
    return;
  }

  const { auth } = createBetterAuth({ dbPath: ':memory:', usePostgres: true });
  const originalExit = process.exit;
  const exitCalls: unknown[] = [];
  process.exit = ((code?: number) => {
    exitCalls.push(code);
    // Исключение вместо выхода; initAuthDatabase может его поглотить, поэтому проверяем exitCalls.
    throw new Error(`process.exit(${String(code)}) called`);
  }) as typeof process.exit;
  try {
    await initAuthDatabase(auth);
  } catch {
    // Демо-регистрация без базы может упасть — здесь важен только process.exit.
  } finally {
    process.exit = originalExit;
  }
  assert.deepEqual(exitCalls, [], 'initAuthDatabase вызвал process.exit');
});
