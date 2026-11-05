import assert from 'node:assert/strict';
import test from 'node:test';
import { STUDY_CONFIG, toolSolution } from '../../testing/builder-fixtures.js';
import { defaultConfig } from '../service.js';
import { MemoryBuilderStore } from '../store.js';
import { MemoryMaterialStore } from './material-store.js';
import { MaterialService } from './material-service.js';
import { MATERIAL_LIMITS, type ExtractedDocument } from './materials.js';

const NOW = '2026-11-05T10:00:00.000Z';
const alice = { userId: 'alice', language: 'ru' as const };

async function setup() {
  const builder = new MemoryBuilderStore();
  const materials = new MemoryMaterialStore((ownerId, id) => builder.getSolution(ownerId, id));
  const service = new MaterialService({ materials, solutions: builder, now: () => new Date(NOW) });
  const version = (solutionId: string) => ({ solutionId, number: 1, createdAt: NOW });
  await builder.createSolution(
    toolSolution('tool', 'alice'),
    { ...version('tool'), config: STUDY_CONFIG },
    [],
  );
  await builder.createSolution(
    { ...toolSolution('assistant', 'alice'), type: 'assistant', template: 'personal_assistant' },
    { ...version('assistant'), config: defaultConfig('Помощник', 'ru') },
    [],
  );
  // Инструмент шаблона, которого нет в этой версии кода: материалы ему не положены.
  await builder.createSolution(
    { ...toolSolution('future', 'alice'), template: 'future_tool' },
    { ...version('future'), config: STUDY_CONFIG },
    [],
  );
  return { service, builder };
}

const doc = (text: string, name = 'lecture.pdf'): ExtractedDocument => ({
  name,
  format: 'pdf',
  sizeBytes: 4096,
  sections: [{ label: 'Стр. 1', text }],
});

test('загрузка: сводка без текста, повтор того же текста — дубль, а не новый материал', async () => {
  const { service } = await setup();
  const first = await service.add(alice, 'tool', doc('Законы Ньютона'));
  assert.ok(first.ok);
  assert.equal(first.duplicate, false);
  assert.equal(first.material.charCount, 'Законы Ньютона'.length);
  const second = await service.add(alice, 'tool', doc('Законы Ньютона', 'copy.pdf'));
  assert.ok(second.ok && second.duplicate);
  assert.equal(second.material.id, first.material.id);
  const list = await service.list(alice, 'tool');
  assert.ok(list.ok);
  assert.equal(list.materials.length, 1);
  assert.equal(list.usage.count, 1);
  assert.equal(list.usage.maxCount, MATERIAL_LIMITS.materialsPerSolution);
});

test('скан без текста — честная ошибка про OCR', async () => {
  const { service } = await setup();
  const result = await service.add(alice, 'tool', doc('   '));
  assert.ok(!result.ok);
  assert.equal(result.status, 422);
  assert.equal(result.code, 'material_no_text');
  assert.match(result.message, /OCR/);
});

test('помощник и неизвестный шаблон документы не принимают; чужой инструмент — 404', async () => {
  const { service } = await setup();
  for (const id of ['assistant', 'future']) {
    const result = await service.add(alice, id, doc('текст'));
    assert.ok(!result.ok);
    assert.equal(result.code, 'wrong_solution_kind');
  }
  const bob = { userId: 'bob', language: 'en' as const };
  for (const result of [
    await service.add(bob, 'tool', doc('текст')),
    await service.list(bob, 'tool'),
    await service.get(bob, 'tool', 'any'),
    await service.remove(bob, 'tool', 'any'),
  ]) {
    assert.ok(!result.ok);
    assert.equal(result.status, 404);
  }
});

test('лимит документов в инструменте', async () => {
  const { service } = await setup();
  for (let i = 0; i < MATERIAL_LIMITS.materialsPerSolution; i += 1) {
    assert.ok((await service.add(alice, 'tool', doc(`документ ${i}`))).ok);
  }
  const over = await service.add(alice, 'tool', doc('ещё один'));
  assert.ok(!over.ok);
  assert.equal(over.code, 'materials_limit');
});

test('лимит объёма на пользователя считает все его инструменты', async () => {
  const { service, builder } = await setup();
  const chunk = MATERIAL_LIMITS.materialChars;
  const perTool = MATERIAL_LIMITS.materialsPerSolution;
  const needed = Math.ceil(MATERIAL_LIMITS.materialCharsPerUser / chunk);
  let added = 0;
  for (let tool = 0; added < needed; tool += 1) {
    const id = `bulk-${tool}`;
    await builder.createSolution(
      toolSolution(id, 'alice'),
      { solutionId: id, number: 1, config: STUDY_CONFIG, createdAt: NOW },
      [],
    );
    for (let i = 0; i < perTool && added < needed; i += 1, added += 1) {
      const text = `${added}`.padEnd(chunk, 'я');
      assert.ok((await service.add(alice, id, doc(text))).ok, `материал ${added}`);
    }
  }
  const over = await service.add(alice, 'tool', doc('последняя капля'));
  assert.ok(!over.ok);
  assert.equal(over.code, 'materials_storage_limit');
});

test('просмотр и удаление своего материала', async () => {
  const { service } = await setup();
  const added = await service.add(alice, 'tool', doc('Периодическая таблица'));
  assert.ok(added.ok);
  const full = await service.get(alice, 'tool', added.material.id);
  assert.ok(full.ok);
  assert.equal(full.material.sections[0]?.text, 'Периодическая таблица');
  assert.deepEqual(await service.remove(alice, 'tool', added.material.id), { ok: true });
  const gone = await service.get(alice, 'tool', added.material.id);
  assert.ok(!gone.ok);
  assert.equal(gone.code, 'material_not_found');
});
