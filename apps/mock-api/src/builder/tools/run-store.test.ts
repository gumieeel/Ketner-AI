import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../../db/migrate.js';
import { MIGRATIONS } from '../../db/migration-list.js';
import { STUDY_CONFIG, toolSolution } from '../../testing/builder-fixtures.js';
import { openTestSql } from '../../testing/sql.js';
import { defaultConfig } from '../service.js';
import { MemoryBuilderStore, PostgresBuilderStore, type BuilderStore } from '../store.js';
import {
  MemoryRunStore,
  PostgresRunStore,
  type RunFinish,
  type RunStore,
  type ToolRun,
} from './run-store.js';

const NOW = '2026-11-05T10:00:00.000Z';
const LATER = '2026-11-05T10:10:00.000Z';

function run(id: string, patch: Partial<ToolRun> = {}): ToolRun {
  return {
    id,
    solutionId: 'tool-a',
    ownerId: 'alice',
    operation: 'notes',
    status: 'queued',
    versionNumber: 1,
    input: { subject: 'Биология', materials: [{ id: 'm1' }] },
    inputHash: `hash-${id}`,
    sources: [
      { ref: 'S1', materialId: 'm1', materialName: 'a.pdf', sectionId: 's1', label: 'Стр. 1' },
    ],
    quote: {
      modelId: 'ketner-pro',
      modelName: 'MiMo-V2.6 Pro',
      maxOutputTokens: 4000,
      inputChars: 100,
      capUsd: 0.02,
      typicalUsd: 0.005,
      maxCredits: 20,
      typicalCredits: 5,
    },
    result: null,
    resultSchema: 1,
    model: null,
    costUsd: 0,
    creditsUsd: 0,
    error: null,
    idempotencyKey: `key-${id}`,
    claimToken: null,
    leaseExpiresAt: '2026-11-05T10:02:00.000Z',
    createdAt: NOW,
    startedAt: null,
    finishedAt: null,
    ...patch,
  };
}

const done = (patch: Partial<RunFinish> = {}): RunFinish => ({
  status: 'done',
  result: { title: 'Клетка', sections: [] },
  model: { id: 'ketner-pro', name: 'MiMo-V2.6 Pro' },
  costUsd: 0.004,
  creditsUsd: 0.004,
  error: null,
  finishedAt: '2026-11-05T10:01:00.000Z',
  ...patch,
});

async function contract(builder: BuilderStore, runs: RunStore): Promise<void> {
  const version = (id: string) => ({
    solutionId: id,
    number: 1,
    config: STUDY_CONFIG,
    createdAt: NOW,
  });
  await builder.createSolution(toolSolution('tool-a', 'alice'), version('tool-a'), []);
  await builder.createSolution(toolSolution('tool-b', 'alice'), version('tool-b'), []);
  await builder.createSolution(toolSolution('tool-bob', 'bob'), version('tool-bob'), []);
  await builder.createSolution(
    { ...toolSolution('assistant', 'alice'), type: 'assistant', template: 'personal_assistant' },
    { solutionId: 'assistant', number: 1, config: defaultConfig('П', 'ru'), createdAt: NOW },
    [],
  );

  assert.equal((await runs.insert(run('r1'))).status, 'created');
  // Тот же ключ — прежний запуск.
  const again = await runs.insert(run('r1-again', { idempotencyKey: 'key-r1' }));
  assert.equal(again.status, 'duplicate');
  assert.equal(again.status === 'duplicate' && again.run.id, 'r1');
  // Второй идущий запуск в том же инструменте — нет; в другом инструменте — да.
  const busy = await runs.insert(run('r2'));
  assert.equal(busy.status, 'busy');
  assert.equal(busy.status === 'busy' && busy.run?.id, 'r1');
  assert.equal((await runs.insert(run('r3', { solutionId: 'tool-b' }))).status, 'created');
  // Только в свой инструмент.
  assert.equal((await runs.insert(run('x1', { solutionId: 'tool-bob' }))).status, 'not_found');
  assert.equal((await runs.insert(run('x2', { solutionId: 'assistant' }))).status, 'not_found');
  assert.deepEqual((await runs.active('alice')).map((item) => item.id).sort(), ['r1', 'r3']);
  assert.equal((await runs.byKey('alice', 'key-r1'))?.id, 'r1');
  assert.equal(await runs.byKey('bob', 'key-r1'), null);

  // Взять в работу можно один раз; итог — только с жетоном взявшего.
  const claimed = await runs.claim('alice', 'r1', 'token-1', LATER, NOW);
  assert.equal(claimed?.status, 'running');
  assert.equal(await runs.claim('alice', 'r1', 'token-2', LATER, NOW), null);
  assert.equal(await runs.claim('bob', 'r3', 'token-x', LATER, NOW), null);
  assert.equal(await runs.finish('alice', 'r1', 'wrong-token', done()), null);
  // Аренда не истекла — закрыть как прерванный нельзя.
  assert.equal(await runs.expire('alice', 'r1', NOW, done({ status: 'failed' })), null);
  const finished = await runs.finish('alice', 'r1', 'token-1', done());
  assert.equal(finished?.status, 'done');
  assert.equal(finished?.creditsUsd, 0.004);
  assert.deepEqual(finished?.result, { title: 'Клетка', sections: [] });
  // Записанный результат не перезаписывается.
  assert.equal(await runs.finish('alice', 'r1', 'token-1', done({ status: 'failed' })), null);

  // Аренда истекла — прерванный; поздний итог того же жетона всё же записывается (результат есть).
  const expired = await runs.expire(
    'alice',
    'r3',
    '2026-11-05T10:05:00.000Z',
    done({ status: 'failed', result: null, error: { code: 'interrupted', message: 'x' } }),
  );
  assert.equal(expired?.status, 'failed');
  assert.equal(expired?.error?.code, 'interrupted');
  assert.deepEqual(await runs.active('alice'), []);

  // Освободился — новый запуск в том же инструменте.
  assert.equal((await runs.insert(run('r4'))).status, 'created');

  // Список: новые сверху, только свои.
  assert.deepEqual(
    (await runs.list('alice', 'tool-a', 10)).map((item) => item.id),
    ['r4', 'r1'],
  );
  assert.deepEqual(await runs.list('bob', 'tool-a', 10), []);
  assert.equal(await runs.get('bob', 'tool-a', 'r1'), null);

  // Удалить можно только завершённый и только свой.
  assert.equal(await runs.remove('alice', 'tool-a', 'r4'), false);
  assert.equal(await runs.remove('bob', 'tool-a', 'r1'), false);
  assert.equal(await runs.remove('alice', 'tool-a', 'r1'), true);

  // Инструмент удалён — его запуски тоже.
  assert.equal(await builder.deleteSolution('alice', 'tool-a'), true);
  assert.equal(await runs.get('alice', 'tool-a', 'r4'), null);
}

test('запуски в памяти: ключ, один идущий запуск, жетон, аренда, удаление', async () => {
  const builder = new MemoryBuilderStore();
  await contract(builder, new MemoryRunStore((ownerId, id) => builder.getSolution(ownerId, id)));
});

test('запуски в Postgres: та же логика и одновременные вставки', async (t) => {
  const sql = await openTestSql();
  if (!sql) {
    t.skip('нет PGlite и TEST_DATABASE_URL');
    return;
  }
  try {
    await runMigrations(sql.db, MIGRATIONS);
    const builder = new PostgresBuilderStore(sql.runner);
    const runs = new PostgresRunStore(sql.runner);
    await contract(builder, runs);

    // Десять одновременных запусков в одном инструменте: создаётся ровно один (уникальный индекс).
    await builder.createSolution(
      toolSolution('tool-race', 'alice'),
      { solutionId: 'tool-race', number: 1, config: STUDY_CONFIG, createdAt: NOW },
      [],
    );
    const raced = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        runs.insert(run(`race-${i}`, { solutionId: 'tool-race' })),
      ),
    );
    assert.equal(raced.filter((item) => item.status === 'created').length, 1);
    assert.equal(raced.filter((item) => item.status === 'busy').length, 9);
    // Десять одновременных запросов с одним ключом: один запуск.
    const sameKey = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        runs.insert(run(`dup-${i}`, { solutionId: 'tool-b', idempotencyKey: 'one-key' })),
      ),
    );
    assert.equal(sameKey.filter((item) => item.status === 'created').length, 1);
    assert.equal(sameKey.filter((item) => item.status === 'duplicate').length, 9);
  } finally {
    await sql.close();
  }
});
