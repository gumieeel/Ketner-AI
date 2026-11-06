/**
 * Процедура отката учебного помощника из docs/operations.md на настоящем Postgres. Тесты выполняют
 * SQL ровно из инструкции (блоки `<!-- rollback:… -->`), чтобы инструкция и проверка не расходились.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { runMigrations } from '../db/migrate.js';
import { MIGRATIONS } from '../db/migration-list.js';
import { openTestSql } from '../testing/sql.js';
import { PostgresBuilderStore } from './store.js';
import { PostgresAttemptStore } from './tools/attempt-store.js';
import { PostgresMaterialStore } from './tools/material-store.js';
import { PostgresRunStore, type ToolRun } from './tools/run-store.js';

type TestSql = NonNullable<Awaited<ReturnType<typeof openTestSql>>>;

function runbookSql(name: 'status' | 'park' | 'unpark'): string {
  const doc = readFileSync(join(import.meta.dirname, '../../../../docs/operations.md'), 'utf8');
  const match = new RegExp(`<!-- rollback:${name} -->\\s*\`\`\`sql\\n([\\s\\S]*?)\`\`\``).exec(doc);
  assert.ok(match?.[1], `в docs/operations.md нет блока rollback:${name}`);
  return match[1];
}

interface Status {
  visible_tools: number;
  parked_tools: number;
  tools_with_slug: number;
  active_runs: number;
  stale_runs: number;
  mismatched_children: number;
}

async function status(sql: TestSql): Promise<Status> {
  const [row] = await sql.runner.query<Record<keyof Status, string | number>>(runbookSql('status'));
  return Object.fromEntries(
    Object.entries(row!).map(([key, value]) => [key, Number(value)]),
  ) as unknown as Status;
}

const park = (sql: TestSql) => sql.runner.query(runbookSql('park'));
const unpark = (sql: TestSql) => sql.runner.query(runbookSql('unpark'));

/** Запросы старого кода (main до 0007) — решения только по user_id. */
const legacy = {
  list: async (sql: TestSql, userId: string) =>
    (
      await sql.runner.query<{ id: string }>(
        'SELECT id FROM solutions WHERE user_id = $1 ORDER BY id',
        [userId],
      )
    ).map((row) => row.id),
  get: async (sql: TestSql, userId: string, id: string) =>
    (
      await sql.runner.query('SELECT id FROM solutions WHERE id = $1 AND user_id = $2', [
        id,
        userId,
      ])
    ).length,
  remove: async (sql: TestSql, userId: string, id: string) =>
    (
      await sql.runner.query('DELETE FROM solutions WHERE id = $1 AND user_id = $2 RETURNING id', [
        id,
        userId,
      ])
    ).length,
};

const TOOLS = [
  ['a-tool-1', 'alice'],
  ['a-tool-2', 'alice'],
  ['b-tool', 'bob'],
] as const;

/** Два пользователя: помощники, бот и три инструмента с материалами, запусками и попытками. */
async function seed(sql: TestSql) {
  await runMigrations(sql.db, MIGRATIONS);
  const solution = (
    id: string,
    owner: string,
    type: string,
    template: string,
    slug: string | null,
  ) =>
    sql.runner.query(
      `INSERT INTO solutions (id, user_id, type, template, status, name, current_version,
         active_version, slug, bot)
       VALUES ($1, $2, $3, $4, 'active', $1, 1, 1, $5, $6::text::jsonb)`,
      [id, owner, type, template, slug, slug ? JSON.stringify({ slug }) : 'null'],
    );
  await solution('a-assistant', 'alice', 'assistant', 'personal_assistant', null);
  await solution('a-bot', 'alice', 'customer_bot', 'customer_bot', 'alice-bot');
  await solution('b-assistant', 'bob', 'assistant', 'personal_assistant', null);
  // Помощник, вставленный «старым кодом» без шаблона (триггер 0011).
  await sql.runner.query(
    `INSERT INTO solutions (id, user_id, type, status, name, current_version)
     VALUES ('b-legacy', 'bob', 'assistant', 'draft', 'legacy', 1)`,
  );
  for (const [id, owner] of TOOLS) {
    await solution(id, owner, 'tool', 'study_assistant', null);
    await sql.runner.query(
      `INSERT INTO solution_versions (solution_id, number, config)
       VALUES ($1, 1, '{"tool":"study_assistant","language":"ru","subject":""}'::jsonb)`,
      [id],
    );
    await sql.runner.query(
      `INSERT INTO solution_materials (id, solution_id, user_id, name, format, size_bytes,
         char_count, outline, sections, content_hash)
       VALUES ($1, $2, $3, 'Биология.pdf', 'pdf', 10, 4,
         '[{"id":"s1","label":"Стр. 1","chars":4}]'::jsonb,
         '[{"id":"s1","label":"Стр. 1","text":"Ядро"}]'::jsonb, $1)`,
      [`m-${id}`, id, owner],
    );
    await insertRun(sql, `r-${id}`, id, owner, 'done', 1);
    await sql.runner.query(
      `INSERT INTO solution_attempts (id, run_id, solution_id, user_id, kind, status,
         question_ids, max_score)
       VALUES ($1, $2, $3, $4, 'quiz', 'submitted', '["q1"]'::jsonb, 1)`,
      [`at-${id}`, `r-${id}`, id, owner],
    );
  }
}

/** Запуск; `leaseMinutes` — через сколько минут истекает аренда (отрицательное — уже истекла). */
function insertRun(
  sql: TestSql,
  id: string,
  solutionId: string,
  owner: string,
  runStatus: 'queued' | 'running' | 'done',
  leaseMinutes: number,
  runner = sql.runner,
) {
  return runner.query(
    `INSERT INTO solution_runs (id, solution_id, user_id, operation, status, version_number,
       input, input_hash, sources, quote, idempotency_key, lease_expires_at)
     VALUES ($1, $2, $3, 'notes', $4, 1, '{}'::jsonb, 'h', '[]'::jsonb, '{}'::jsonb, $1,
       now() + make_interval(mins => $5))`,
    [id, solutionId, owner, runStatus, leaseMinutes],
  );
}

/** Всё, что процедура не должна менять: помощники, боты и дочерние записи — строками целиком. */
async function untouched(sql: TestSql) {
  const rows = (query: string) =>
    sql.runner.query<{ row: unknown }>(query).then((items) => items.map((item) => item.row));
  return {
    others: await rows(
      `SELECT row_to_json(s) AS row FROM solutions s
       WHERE type IN ('assistant', 'customer_bot') ORDER BY id`,
    ),
    versions: await rows(
      'SELECT row_to_json(v) AS row FROM solution_versions v ORDER BY solution_id, number',
    ),
    materials: await rows('SELECT row_to_json(m) AS row FROM solution_materials m ORDER BY id'),
    runs: await rows('SELECT row_to_json(r) AS row FROM solution_runs r ORDER BY id'),
    attempts: await rows('SELECT row_to_json(a) AS row FROM solution_attempts a ORDER BY id'),
  };
}

async function withSql(t: test.TestContext, body: (sql: TestSql) => Promise<void>) {
  const sql = await openTestSql();
  if (!sql) {
    t.skip('нет PGlite и TEST_DATABASE_URL');
    return;
  }
  try {
    await body(sql);
  } finally {
    await sql.close();
  }
}

test('откат: несколько инструментов прячутся и возвращаются; повтор безопасен; остальное не тронуто', (t) =>
  withSql(t, async (sql) => {
    await seed(sql);
    const before = await untouched(sql);
    assert.deepEqual(await status(sql), {
      visible_tools: 3,
      parked_tools: 0,
      tools_with_slug: 0,
      active_runs: 0,
      stale_runs: 0,
      mismatched_children: 0,
    });
    assert.deepEqual(await legacy.list(sql, 'alice'), [
      'a-assistant',
      'a-bot',
      'a-tool-1',
      'a-tool-2',
    ]);

    // Прятка: N = 3, повтор ничего не меняет.
    await park(sql);
    await park(sql);
    const parked = await status(sql);
    assert.equal(parked.visible_tools, 0);
    assert.equal(parked.parked_tools, 3);
    assert.equal(parked.tools_with_slug, 0);
    // Материал, запуск и попытка у каждого из трёх спрятанных инструментов.
    assert.equal(parked.mismatched_children, 9);
    assert.deepEqual(
      await untouched(sql),
      before,
      'помощники, боты и дочерние записи не изменились',
    );

    // Старый код инструментов не видит и не может их удалить.
    assert.deepEqual(await legacy.list(sql, 'alice'), ['a-assistant', 'a-bot']);
    assert.deepEqual(await legacy.list(sql, 'bob'), ['b-assistant', 'b-legacy']);
    for (const [id, owner] of TOOLS) {
      assert.equal(await legacy.get(sql, owner, id), 0, id);
      assert.equal(await legacy.remove(sql, owner, id), 0, id);
    }
    // Новый код спрятанные инструменты тоже не видит — и не может начать в них запуск.
    const store = new PostgresBuilderStore(sql.runner);
    assert.equal(await store.getSolution('alice', 'a-tool-1'), null);
    const runs = new PostgresRunStore(sql.runner);
    const started = await runs.insert(newRun('late', 'a-tool-1', 'alice'));
    assert.equal(started.status, 'not_found');

    // Возврат, повтор безопасен.
    await unpark(sql);
    await unpark(sql);
    assert.deepEqual(await status(sql), {
      visible_tools: 3,
      parked_tools: 0,
      tools_with_slug: 0,
      active_runs: 0,
      stale_runs: 0,
      mismatched_children: 0,
    });
    assert.deepEqual(await untouched(sql), before);

    // Каждый инструмент снова доступен владельцу вместе с материалами, запусками и попытками.
    const materials = new PostgresMaterialStore(sql.runner);
    const attempts = new PostgresAttemptStore(sql.runner);
    for (const [id, owner] of TOOLS) {
      const solution = await store.getSolution(owner, id);
      assert.equal(solution?.type, 'tool', id);
      assert.equal(solution?.template, 'study_assistant', id);
      assert.deepEqual(
        (await materials.list(owner, id)).map((item) => item.id),
        [`m-${id}`],
      );
      assert.deepEqual(
        (await runs.list(owner, id, 10)).map((item) => item.id),
        [`r-${id}`],
      );
      assert.deepEqual(
        (await attempts.list(owner, id)).map((item) => item.id),
        [`at-${id}`],
      );
      // Чужому — по-прежнему нет.
      const stranger = owner === 'alice' ? 'bob' : 'alice';
      assert.equal(await store.getSolution(stranger, id), null);
    }
  }));

function newRun(id: string, solutionId: string, ownerId: string): ToolRun {
  const at = new Date().toISOString();
  return {
    id,
    solutionId,
    ownerId,
    operation: 'notes',
    status: 'queued',
    versionNumber: 1,
    input: {},
    inputHash: 'h',
    sources: [],
    quote: {
      modelId: 'ketner-pro',
      modelName: 'm',
      maxOutputTokens: 1,
      inputChars: 1,
      capUsd: 0.01,
      typicalUsd: 0.01,
      maxCredits: 1,
      typicalCredits: 1,
    },
    result: null,
    resultSchema: 1,
    model: null,
    costUsd: 0,
    creditsUsd: 0,
    error: null,
    idempotencyKey: id,
    claimToken: null,
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: at,
    startedAt: null,
    finishedAt: null,
  };
}

test('откат: идущий запуск не даёт спрятать инструменты, оборванный (аренда истекла) — не мешает', (t) =>
  withSql(t, async (sql) => {
    await seed(sql);
    await insertRun(sql, 'r-active', 'a-tool-2', 'alice', 'running', 3);
    const before = await untouched(sql);
    assert.equal((await status(sql)).active_runs, 1);
    await assert.rejects(park(sql), /active tool run/);
    // Ничего не изменилось.
    assert.equal((await status(sql)).parked_tools, 0);
    assert.deepEqual(await untouched(sql), before);

    // Процесс остановлен (Suspend), аренда истекла — запуск оборван, прятке он не мешает.
    await sql.runner.query(
      `UPDATE solution_runs SET lease_expires_at = now() - interval '1 minute' WHERE id = 'r-active'`,
    );
    const drained = await status(sql);
    assert.equal(drained.active_runs, 0);
    assert.equal(drained.stale_runs, 1);
    await park(sql);
    assert.equal((await status(sql)).parked_tools, 3);
    // Оборванный запуск остаётся как был: его закроет новая версия после возврата.
    const [run] = await sql.runner.query<{ status: string }>(
      `SELECT status FROM solution_runs WHERE id = 'r-active'`,
    );
    assert.equal(run?.status, 'running');
    await unpark(sql);
    assert.equal((await status(sql)).mismatched_children, 0);
  }));

test('откат: запуск, который начинается во время прятки, либо ждёт и отменяет её, либо не создаётся', (t) =>
  withSql(t, async (sql) => {
    await seed(sql);
    // Запрос пользователя уже вставляет запуск (транзакция не закрыта), когда начинается прятка.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let inserted!: () => void;
    const insertedSignal = new Promise<void>((resolve) => (inserted = resolve));
    const request = sql.db.transaction(async (tx) => {
      await insertRun(sql, 'r-race', 'a-tool-1', 'alice', 'queued', 2, tx);
      inserted();
      await gate;
    });
    await insertedSignal;
    const parking = park(sql).then(
      () => 'parked',
      (error: Error) => error.message,
    );
    // Прятка ждёт блокировку, пока запрос не завершится.
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await request;
    assert.match(
      await parking,
      /active tool run/,
      'прятка увидела новый запуск и ничего не сделала',
    );
    assert.equal((await status(sql)).parked_tools, 0);

    // Обратный порядок: прятка прошла первой — новый запуск в спрятанном инструменте не создаётся.
    await sql.runner.query(`UPDATE solution_runs SET status = 'done' WHERE id = 'r-race'`);
    await park(sql);
    const runs = new PostgresRunStore(sql.runner);
    assert.equal((await runs.insert(newRun('r-after', 'a-tool-1', 'alice'))).status, 'not_found');
    assert.equal((await status(sql)).active_runs, 0);
  }));

test('откат: прерванная процедура — возврат без прятки ничего не меняет, несовпадение владельца отменяет возврат', (t) =>
  withSql(t, async (sql) => {
    await seed(sql);
    const before = await untouched(sql);
    // Откат отменили до прятки: возврат безопасен и ничего не делает.
    await unpark(sql);
    assert.equal((await status(sql)).visible_tools, 3);
    assert.deepEqual(await untouched(sql), before);

    // Спрятали, а дочерняя запись оказалась чужой (например, правка вручную) — возврат отменяется
    // целиком: инструменты остаются спрятанными, ничего не возвращено наполовину.
    await park(sql);
    await sql.runner.query(
      `UPDATE solution_materials SET user_id = 'mallory' WHERE id = 'm-a-tool-1'`,
    );
    await assert.rejects(unpark(sql), /do not match their owner/);
    const stuck = await status(sql);
    assert.equal(stuck.parked_tools, 3);
    assert.equal(stuck.visible_tools, 0);
    // После исправления возврат проходит.
    await sql.runner.query(
      `UPDATE solution_materials SET user_id = 'alice' WHERE id = 'm-a-tool-1'`,
    );
    await unpark(sql);
    const restored = await status(sql);
    assert.equal(restored.parked_tools, 0);
    assert.equal(restored.mismatched_children, 0);
    assert.deepEqual(await untouched(sql), before);
  }));
