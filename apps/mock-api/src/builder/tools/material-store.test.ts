import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../../db/migrate.js';
import { MIGRATIONS } from '../../db/migration-list.js';
import { openTestSql } from '../../testing/sql.js';
import { defaultConfig } from '../service.js';
import { MemoryBuilderStore, PostgresBuilderStore, type BuilderStore } from '../store.js';
import { STUDY_CONFIG, toolSolution } from '../../testing/builder-fixtures.js';
import {
  MemoryMaterialStore,
  PostgresMaterialStore,
  type MaterialStore,
} from './material-store.js';
import { buildMaterial, type Material } from './materials.js';

const NOW = '2026-11-05T10:00:00.000Z';

function material(
  id: string,
  solutionId: string,
  ownerId: string,
  body: string,
  at = NOW,
): Material {
  const built = buildMaterial({
    name: `${id}.docx`,
    format: 'docx',
    sizeBytes: 2048,
    sections: [
      { label: 'Раздел 1', text: body },
      { label: 'Раздел 2', text: `${body} — продолжение` },
    ],
  });
  assert.ok(built.ok);
  const { ok: _ok, ...rest } = built;
  return { id, solutionId, ownerId, createdAt: at, ...rest };
}

async function contract(builder: BuilderStore, materials: MaterialStore): Promise<void> {
  await builder.createSolution(
    toolSolution('tool-a', 'alice'),
    { solutionId: 'tool-a', number: 1, config: STUDY_CONFIG, createdAt: NOW },
    [],
  );
  await builder.createSolution(
    toolSolution('tool-b', 'bob'),
    { solutionId: 'tool-b', number: 1, config: STUDY_CONFIG, createdAt: NOW },
    [],
  );
  await builder.createSolution(
    {
      ...toolSolution('assistant-a', 'alice'),
      type: 'assistant',
      template: 'personal_assistant',
    },
    {
      solutionId: 'assistant-a',
      number: 1,
      config: defaultConfig('Помощник', 'ru'),
      createdAt: NOW,
    },
    [],
  );

  const first = material('m1', 'tool-a', 'alice', 'Клетка — единица живого');
  assert.equal((await materials.add(first)).status, 'created');
  assert.equal(
    (await materials.add(material('m2', 'tool-a', 'alice', 'Митоз', '2026-11-05T11:00:00.000Z')))
      .status,
    'created',
  );

  // Тот же текст в том же инструменте — прежний материал, новый не создаётся.
  const again = await materials.add({ ...first, id: 'm1-again', name: 'копия.docx' });
  assert.equal(again.status, 'duplicate');
  assert.equal(again.status === 'duplicate' && again.material.id, 'm1');

  // Только в свой инструмент: чужой инструмент и помощник — как несуществующие.
  assert.equal(
    (await materials.add(material('x1', 'tool-b', 'alice', 'чужое'))).status,
    'not_found',
  );
  assert.equal(
    (await materials.add(material('x2', 'assistant-a', 'alice', 'помощнику'))).status,
    'not_found',
  );
  assert.equal(
    (await materials.add(material('x3', 'missing', 'alice', 'нет'))).status,
    'not_found',
  );

  // Список: новые сверху, без текста частей.
  const list = await materials.list('alice', 'tool-a');
  assert.deepEqual(
    list.map((item) => item.id),
    ['m2', 'm1'],
  );
  assert.ok(!JSON.stringify(list).includes('Клетка'));
  assert.deepEqual(
    list[1]?.sections.map((section) => section.id),
    ['s1', 's2'],
  );
  assert.deepEqual(await materials.list('bob', 'tool-a'), []);

  // Текст — только владельцу.
  assert.equal(
    (await materials.get('alice', 'tool-a', 'm1'))?.sections[0]?.text,
    'Клетка — единица живого',
  );
  assert.equal(await materials.get('bob', 'tool-a', 'm1'), null);
  assert.equal(await materials.get('alice', 'tool-b', 'm1'), null);

  assert.equal(await materials.totalChars('alice'), first.charCount + list[0]!.charCount);
  assert.equal(await materials.totalChars('bob'), 0);

  // Удаление: чужой не удалит, владелец — да.
  assert.equal(await materials.remove('bob', 'tool-a', 'm2'), false);
  assert.equal(await materials.remove('alice', 'tool-a', 'm2'), true);
  assert.equal(await materials.remove('alice', 'tool-a', 'm2'), false);

  // Удалили инструмент — его материалы тоже.
  assert.equal(await builder.deleteSolution('alice', 'tool-a'), true);
  assert.deepEqual(await materials.list('alice', 'tool-a'), []);
  assert.equal(await materials.totalChars('alice'), 0);
}

test('материалы в памяти: только свой инструмент, без дублей, удаление вместе с инструментом', async () => {
  const builder = new MemoryBuilderStore();
  await contract(
    builder,
    new MemoryMaterialStore((ownerId, id) => builder.getSolution(ownerId, id)),
  );
});

test('материалы в Postgres: та же логика', async (t) => {
  const sql = await openTestSql();
  if (!sql) {
    t.skip('нет PGlite и TEST_DATABASE_URL');
    return;
  }
  try {
    await runMigrations(sql.db, MIGRATIONS);
    await contract(new PostgresBuilderStore(sql.runner), new PostgresMaterialStore(sql.runner));
  } finally {
    await sql.close();
  }
});
