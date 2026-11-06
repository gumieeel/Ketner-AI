import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../../db/migrate.js';
import { MIGRATIONS } from '../../db/migration-list.js';
import { STUDY_CONFIG, toolSolution } from '../../testing/builder-fixtures.js';
import { openTestSql } from '../../testing/sql.js';
import { MemoryBuilderStore, PostgresBuilderStore, type BuilderStore } from '../store.js';
import {
  MemoryAttemptStore,
  PostgresAttemptStore,
  type Attempt,
  type AttemptStore,
} from './attempt-store.js';
import { MemoryRunStore, PostgresRunStore, type RunStore, type ToolRun } from './run-store.js';

const NOW = '2026-11-06T10:00:00.000Z';

function run(id: string, patch: Partial<ToolRun> = {}): ToolRun {
  return {
    id,
    solutionId: 'tool-a',
    ownerId: 'alice',
    operation: 'quiz',
    status: 'queued',
    versionNumber: 1,
    input: {},
    inputHash: id,
    sources: [],
    quote: {
      modelId: 'ketner-pro',
      modelName: 'MiMo',
      maxOutputTokens: 1,
      inputChars: 1,
      capUsd: 0.01,
      typicalUsd: 0.01,
      maxCredits: 10,
      typicalCredits: 1,
    },
    result: null,
    resultSchema: 1,
    model: null,
    costUsd: 0,
    creditsUsd: 0,
    error: null,
    idempotencyKey: `key-${id}`,
    claimToken: null,
    leaseExpiresAt: '2026-11-06T10:02:00.000Z',
    createdAt: NOW,
    startedAt: null,
    finishedAt: null,
    ...patch,
  };
}

function attempt(id: string, patch: Partial<Attempt> = {}): Attempt {
  return {
    id,
    runId: 'run-done',
    solutionId: 'tool-a',
    ownerId: 'alice',
    kind: 'quiz',
    status: 'in_progress',
    questionIds: ['q1', 'q2'],
    answers: {},
    results: null,
    score: null,
    maxScore: 2,
    retryOf: null,
    gradeRunId: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    submittedAt: null,
    gradedAt: null,
    ...patch,
  };
}

async function contract(builder: BuilderStore, runs: RunStore, attempts: AttemptStore) {
  const version = (id: string) => ({
    solutionId: id,
    number: 1,
    config: STUDY_CONFIG,
    createdAt: NOW,
  });
  await builder.createSolution(toolSolution('tool-a', 'alice'), version('tool-a'), []);
  await builder.createSolution(toolSolution('tool-bob', 'bob'), version('tool-bob'), []);
  const finish = async (r: ToolRun) => {
    await runs.insert(r);
    await runs.claim(r.ownerId, r.id, 't', NOW, NOW);
    await runs.finish(r.ownerId, r.id, 't', {
      status: 'done',
      result: { title: 'x', questions: [] },
      model: null,
      costUsd: 0,
      creditsUsd: 0,
      error: null,
      finishedAt: NOW,
    });
  };
  await finish(run('run-done'));
  await runs.insert(run('run-queued', { solutionId: 'tool-a', idempotencyKey: 'other' }));
  await finish(run('run-bob', { solutionId: 'tool-bob', ownerId: 'bob' }));

  // Только по завершённому запуску самого владельца.
  assert.equal((await attempts.create(attempt('a1')))?.id, 'a1');
  assert.equal(await attempts.create(attempt('x1', { runId: 'run-queued' })), null);
  assert.equal(await attempts.create(attempt('x2', { runId: 'run-bob' })), null);
  assert.equal(
    await attempts.create(attempt('x3', { runId: 'run-bob', solutionId: 'tool-bob' })),
    null,
  );
  assert.equal(await attempts.create(attempt('x4', { runId: 'missing' })), null);

  // Чтение — только владельцу, в своём инструменте.
  assert.deepEqual((await attempts.get('alice', 'tool-a', 'a1'))?.questionIds, ['q1', 'q2']);
  assert.equal(await attempts.get('bob', 'tool-a', 'a1'), null);
  assert.equal(await attempts.get('alice', 'tool-bob', 'a1'), null);

  // Запись по версии: устаревшая версия не затирает свежую.
  const current = (await attempts.get('alice', 'tool-a', 'a1'))!;
  const saved = await attempts.update(
    { ...current, answers: { q1: { selected: 1 } } },
    current.version,
  );
  assert.equal(saved?.version, current.version + 1);
  assert.equal(
    await attempts.update({ ...current, answers: { q1: { selected: 0 } } }, current.version),
    null,
  );
  assert.equal(await attempts.update({ ...saved!, ownerId: 'bob' }, saved!.version), null);
  const submitted = await attempts.update(
    {
      ...saved!,
      status: 'submitted',
      results: [{ questionId: 'q1', verdict: 'correct', score: 1 }],
      score: 1,
      gradeRunId: 'grade-1',
      submittedAt: NOW,
    },
    saved!.version,
  );
  assert.equal(submitted?.status, 'submitted');
  assert.equal(submitted?.score, 1);
  assert.equal(submitted?.gradeRunId, 'grade-1');
  assert.deepEqual(submitted?.results, [{ questionId: 'q1', verdict: 'correct', score: 1 }]);

  // Список: новые сверху, фильтр по запуску.
  await attempts.create(attempt('a2', { createdAt: '2026-11-06T11:00:00.000Z' }));
  assert.deepEqual(
    (await attempts.list('alice', 'tool-a')).map((item) => item.id),
    ['a2', 'a1'],
  );
  assert.deepEqual(
    (await attempts.list('alice', 'tool-a', { runId: 'other' })).map((item) => item.id),
    [],
  );
  assert.deepEqual(await attempts.list('bob', 'tool-a'), []);

  // Запуск удалён — его попытки тоже.
  assert.equal(await runs.remove('alice', 'tool-a', 'run-done'), true);
  assert.deepEqual(await attempts.list('alice', 'tool-a'), []);
}

test('попытки в памяти: только по своему завершённому запуску, версия, удаление с запуском', async () => {
  const builder = new MemoryBuilderStore();
  const runs = new MemoryRunStore((ownerId, id) => builder.getSolution(ownerId, id));
  await contract(
    builder,
    runs,
    new MemoryAttemptStore((ownerId, solutionId, id) => runs.get(ownerId, solutionId, id)),
  );
});

test('попытки в Postgres: та же логика и одновременные записи', async (t) => {
  const sql = await openTestSql();
  if (!sql) {
    t.skip('нет PGlite и TEST_DATABASE_URL');
    return;
  }
  try {
    await runMigrations(sql.db, MIGRATIONS);
    const builder = new PostgresBuilderStore(sql.runner);
    const runs = new PostgresRunStore(sql.runner);
    const attempts = new PostgresAttemptStore(sql.runner);
    await contract(builder, runs, attempts);

    // Пять одновременных записей одной версии: проходит одна.
    // Свой инструмент: в tool-a контракт оставил идущий запуск, а второй там не создаётся.
    await builder.createSolution(
      toolSolution('tool-race', 'alice'),
      { solutionId: 'tool-race', number: 1, config: STUDY_CONFIG, createdAt: NOW },
      [],
    );
    await runs.insert(run('run-race', { idempotencyKey: 'race', solutionId: 'tool-race' }));
    await runs.claim('alice', 'run-race', 't', NOW, NOW);
    await runs.finish('alice', 'run-race', 't', {
      status: 'done',
      result: {},
      model: null,
      costUsd: 0,
      creditsUsd: 0,
      error: null,
      finishedAt: NOW,
    });
    const base = (await attempts.create(
      attempt('race', { runId: 'run-race', solutionId: 'tool-race' }),
    ))!;
    const writes = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        attempts.update({ ...base, answers: { q1: { selected: i } } }, base.version),
      ),
    );
    assert.equal(writes.filter(Boolean).length, 1);
  } finally {
    await sql.close();
  }
});
