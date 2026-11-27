/**
 * Обрыв соединения с базой (инцидент 26.11.2026: Supabase закрыл соединение, код 57P01).
 * Клиент — с настройками сервера (db/connection.ts: пул из 10 соединений). Соединения обрываются
 * со второго клиента через pg_terminate_backend:
 * 1) во время запроса — запрос отклоняется временной ошибкой, следующий запрос проходит;
 * 2) все соединения сразу, в простое (как перезапуск пулера Supabase) — запросы, попавшие на
 *    мёртвые соединения, получают временную ошибку, затем снова проходят.
 * Ни в одном случае нет необработанного отказа. Без TEST_DATABASE_URL тест пропускается.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import postgres from 'postgres';
import { errorCode, isTransientConnectionError } from '../process-safety.js';
import { createQueryClient } from './connection.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('обрыв соединения во время запроса и в простое: следующие запросы проходят', async (t) => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    t.skip('нет TEST_DATABASE_URL');
    return;
  }
  // Своё имя приложения: обрываются только соединения этого клиента — тесты идут параллельно.
  const marker = `conn_test_${process.pid}_${Date.now()}`;
  const sql = createQueryClient(url, {
    connect_timeout: 5,
    connection: { application_name: marker },
  });
  const admin = postgres(url, { onnotice: () => {}, max: 1 });
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  process.on('unhandledRejection', onRejection);
  t.after(async () => {
    process.off('unhandledRejection', onRejection);
    await sql.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });
  /** Запрос «как от посетителя»: результат или код ошибки. */
  const request = async (n: number): Promise<number | string> => {
    try {
      const [row] = await sql`select ${n}::int as n`;
      return row!.n as number;
    } catch (error) {
      return `failed:${errorCode(error)}`;
    }
  };

  // Прогрев: в пуле несколько открытых соединений.
  await Promise.all(Array.from({ length: 4 }, () => sql`select pg_sleep(0.05)`));

  // 1. Обрыв во время запроса.
  const slow = sql`select pg_sleep(10)`.then(
    () => null,
    (error: unknown) => error,
  );
  let pid: number | null = null;
  for (let attempt = 0; attempt < 100 && pid === null; attempt += 1) {
    const [row] = await admin`
      select pid from pg_stat_activity
      where application_name = ${marker} and state = 'active' and query like 'select pg_sleep(10)%'`;
    pid = (row?.pid as number | undefined) ?? null;
    if (pid === null) await sleep(50);
  }
  assert.ok(pid, 'долгий запрос найден на сервере');
  await admin`select pg_terminate_backend(${pid})`;
  const failure = await slow;
  // Сервер шлёт FATAL 57P01 и закрывает сокет; что postgres.js увидит первым, зависит от времени.
  assert.ok(isTransientConnectionError(failure), `временная ошибка: ${errorCode(failure)}`);
  assert.equal(await request(1), 1, 'следующий запрос проходит');
  for (let n = 2; n <= 6; n += 1) assert.equal(await request(n), n);

  // 2. Все соединения клиента оборваны в простое (перезапуск пулера).
  const [killed] = await admin`
    select count(pg_terminate_backend(pid))::int as n from pg_stat_activity
    where application_name = ${marker}`;
  assert.ok(killed!.n > 0, 'соединения клиента оборваны');
  const results: Array<number | string> = [];
  for (let n = 1; n <= 12; n += 1) results.push(await request(n));
  // Запросы, попавшие на мёртвые соединения, — временная ошибка; дальше всё проходит.
  const firstOk = results.findIndex((value) => typeof value === 'number');
  assert.ok(firstOk >= 0 && firstOk <= 10, JSON.stringify(results));
  for (const value of results.slice(0, firstOk)) {
    assert.ok(
      isTransientConnectionError({ code: String(value).replace('failed:', '') }),
      String(value),
    );
  }
  assert.deepEqual(
    results.slice(firstOk),
    Array.from({ length: 12 - firstOk }, (_, index) => firstOk + index + 1),
  );

  await sleep(100);
  assert.deepEqual(rejections, [], 'необработанных отказов нет');
});
