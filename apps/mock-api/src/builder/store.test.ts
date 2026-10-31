import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../db/migrate.js';
import { MIGRATIONS } from '../db/migration-list.js';
import { openTestSql } from '../testing/sql.js';
import { defaultConfig } from './service.js';
import { MemoryBuilderStore, PostgresBuilderStore, type BuilderStore } from './store.js';
import type { Solution, TestCase, TestRun } from './types.js';

const NOW = '2026-10-31T10:00:00.000Z';

function solution(id: string, ownerId: string): Solution {
  return {
    id,
    ownerId,
    type: 'assistant',
    status: 'draft',
    name: `Помощник ${id}`,
    currentVersion: 1,
    activeVersion: null,
    source: { analysisId: 'an-1', opportunityId: 'o-1', title: 'Возможность' },
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
  };
}

function testCase(id: string, solutionId: string, position: number): TestCase {
  return {
    id,
    solutionId,
    position,
    input: `Вопрос ${position}`,
    criteria: ['Вежливо'],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function contract(store: BuilderStore): Promise<void> {
  await store.createSolution(
    solution('s1', 'alice'),
    { solutionId: 's1', number: 1, config: defaultConfig('Помощник', 'ru'), createdAt: NOW },
    [testCase('c1', 's1', 0)],
  );
  await store.createSolution(
    solution('s2', 'bob'),
    { solutionId: 's2', number: 1, config: defaultConfig('Чужой', 'ru'), createdAt: NOW },
    [],
  );

  // Владелец видит своё, чужое — нет.
  assert.equal((await store.getSolution('alice', 's1'))?.source?.opportunityId, 'o-1');
  assert.equal(await store.getSolution('alice', 's2'), null);
  assert.deepEqual(
    (await store.listSolutions('alice')).map((item) => item.id),
    ['s1'],
  );

  // Версии: только своему помощнику, номер не повторяется.
  assert.equal(
    await store.addVersion('alice', {
      solutionId: 's1',
      number: 2,
      config: { ...defaultConfig('Помощник', 'ru'), instructions: 'Кратко' },
      createdAt: NOW,
    }),
    true,
  );
  assert.equal(
    await store.addVersion('alice', {
      solutionId: 's1',
      number: 2,
      config: defaultConfig('x', 'ru'),
      createdAt: NOW,
    }),
    false,
  );
  assert.equal(
    await store.addVersion('bob', {
      solutionId: 's1',
      number: 3,
      config: defaultConfig('x', 'ru'),
      createdAt: NOW,
    }),
    false,
  );
  assert.equal((await store.getVersion('alice', 's1', 2))?.config.instructions, 'Кратко');
  assert.equal(await store.getVersion('bob', 's1', 2), null);
  assert.deepEqual(
    (await store.listVersions('alice', 's1')).map((item) => item.number),
    [2, 1],
  );

  // Запись помощника — с версией.
  const current = (await store.getSolution('alice', 's1')) as Solution;
  const updated = await store.updateSolution(
    { ...current, currentVersion: 2, status: 'active', activeVersion: 2 },
    current.version,
  );
  assert.equal(updated?.activeVersion, 2);
  assert.equal(await store.updateSolution({ ...current, name: 'x' }, current.version), null);
  assert.equal(await store.updateSolution({ ...current, ownerId: 'bob' }, updated!.version), null);

  // Кейсы.
  assert.equal(await store.saveCase('alice', testCase('c2', 's1', 1)), true);
  assert.equal(await store.saveCase('bob', testCase('c3', 's1', 2)), false);
  assert.equal(
    await store.saveCase('alice', { ...testCase('c1', 's1', 0), input: 'Изменённый' }),
    true,
  );
  assert.deepEqual(
    (await store.listCases('alice', 's1')).map((item) => item.input),
    ['Изменённый', 'Вопрос 1'],
  );
  assert.equal(await store.deleteCase('bob', 's1', 'c2'), false);
  assert.equal(await store.deleteCase('alice', 's1', 'c2'), true);

  // Прогоны.
  const run: TestRun = {
    id: 'r1',
    solutionId: 's1',
    ownerId: 'alice',
    versionNumber: 2,
    casesHash: 'h',
    status: 'running',
    results: [],
    createdAt: NOW,
    finishedAt: null,
    version: 1,
  };
  assert.equal(await store.createRun(run), true);
  assert.equal(await store.createRun({ ...run, id: 'r2', ownerId: 'bob' }), false);
  const done = await store.updateRun({ ...run, status: 'done', finishedAt: NOW }, 1);
  assert.equal(done?.status, 'done');
  assert.equal(await store.updateRun({ ...run, status: 'done' }, 1), null);
  assert.equal((await store.latestRun('alice', 's1'))?.id, 'r1');
  assert.equal(await store.getRun('bob', 'r1'), null);

  // Чат.
  assert.equal(
    await store.createThread({
      id: 't1',
      solutionId: 's1',
      ownerId: 'alice',
      title: 'Чат',
      createdAt: NOW,
      updatedAt: NOW,
    }),
    true,
  );
  assert.equal(
    await store.createThread({
      id: 't2',
      solutionId: 's1',
      ownerId: 'bob',
      title: 'Чужой',
      createdAt: NOW,
      updatedAt: NOW,
    }),
    false,
  );
  for (let index = 0; index < 3; index += 1) {
    await store.addMessage({
      id: `m${index}`,
      threadId: 't1',
      ownerId: 'alice',
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `Сообщение ${index}`,
      model: index % 2 === 1 ? { id: 'ketner-pro', name: 'MiMo-V2.6 Pro' } : null,
      image: null,
      status: 'complete',
      createdAt: `2026-10-31T10:00:0${index}.000Z`,
    });
  }
  assert.equal(
    await store.addMessage({
      id: 'mx',
      threadId: 't1',
      ownerId: 'bob',
      role: 'user',
      content: 'Чужое',
      model: null,
      image: null,
      status: 'complete',
      createdAt: NOW,
    }),
    false,
  );
  const last = await store.listMessages('alice', 't1', 2);
  assert.deepEqual(
    last.map((item) => item.content),
    ['Сообщение 1', 'Сообщение 2'],
  );
  assert.equal(last[0].model?.name, 'MiMo-V2.6 Pro');
  assert.deepEqual(await store.listMessages('bob', 't1', 10), []);

  // Удаление — со всем содержимым; чужое не удаляется.
  assert.equal(await store.deleteSolution('bob', 's1'), false);
  assert.equal(await store.deleteSolution('alice', 's1'), true);
  assert.equal(await store.getThread('alice', 't1'), null);
  assert.equal(await store.getRun('alice', 'r1'), null);
  assert.deepEqual(await store.listCases('alice', 's1'), []);
}

test('хранилище Builder в памяти: владелец, версии, кейсы, прогоны, чат, удаление', async () => {
  await contract(new MemoryBuilderStore());
});

test('хранилище Builder в Postgres: та же логика', async (t) => {
  const sql = await openTestSql();
  if (!sql) {
    t.skip('нет PGlite и TEST_DATABASE_URL');
    return;
  }
  try {
    await runMigrations(sql.db, MIGRATIONS);
    await contract(new PostgresBuilderStore(sql.runner));
  } finally {
    await sql.close();
  }
});
