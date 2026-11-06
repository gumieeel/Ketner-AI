import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptedRecipe, RECIPE_IDS, RECIPES } from '../discovery/analysis-map.js';
import { CAPABILITIES, CAPABILITY_IDS } from '../discovery/capabilities.js';
import { setRolloutForTests } from '../services/rollout.js';
import {
  galleryTemplates,
  getTemplate,
  isTemplateEnabled,
  isTemplateId,
  KIND_BY_TYPE,
  SOLUTION_KINDS,
  TEMPLATE_IDS,
  TEMPLATES,
} from './templates.js';

test('реестр шаблонов: id совпадают с ключами, без повторов', () => {
  assert.equal(new Set(TEMPLATE_IDS).size, TEMPLATE_IDS.length);
  assert.deepEqual(Object.keys(TEMPLATES).sort(), [...TEMPLATE_IDS].sort());
  for (const id of TEMPLATE_IDS) assert.equal(TEMPLATES[id].id, id);
});

test('шаблоны требуют только возможности из каталога, кроме «other»', () => {
  for (const template of Object.values(TEMPLATES)) {
    assert.ok(template.requires.length > 0, `${template.id}: пустые requires`);
    for (const capability of template.requires) {
      assert.ok(CAPABILITY_IDS.includes(capability), `${template.id}: ${capability}`);
      assert.notEqual(capability, 'other', `${template.id}: «other» не описывает возможность`);
    }
  }
});

test('тип хранения шаблона соответствует его виду', () => {
  for (const template of Object.values(TEMPLATES)) {
    assert.ok(SOLUTION_KINDS.includes(template.kind));
    assert.equal(KIND_BY_TYPE[template.storageType], template.kind, template.id);
  }
});

test('рецепты анализа, создающие решения, есть в реестре шаблонов', () => {
  // weekly_content пока не реализован (available: false в analysis-map.ts) — шаблона нет.
  for (const recipe of RECIPE_IDS.filter((id) => id !== 'weekly_content')) {
    assert.ok(isTemplateId(recipe), recipe);
  }
});

test('неизвестный шаблон не подменяется другим', () => {
  assert.equal(getTemplate('study_assistant_v0'), null);
  assert.equal(getTemplate(''), null);
  assert.equal(getTemplate('personal_assistant')?.kind, 'assistant');
  assert.equal(getTemplate('customer_bot')?.storageType, 'customer_bot');
});

test('учебный помощник за флагом: выключен — нет ни в галерее, ни в каталоге, ни в рецептах', (t) => {
  t.after(() => setRolloutForTests(null));
  setRolloutForTests({ studyAssistant: false });
  assert.equal(isTemplateEnabled('study_assistant'), false);
  assert.deepEqual(galleryTemplates(), []);
  assert.equal(CAPABILITIES.document_tools.availability, 'unavailable');
  assert.equal(RECIPES.study_assistant.available, false);
  assert.equal(
    acceptedRecipe('study_assistant', 'ready', ['text_generation', 'document_tools']),
    null,
  );
  // Помощники от флага не зависят.
  assert.equal(isTemplateEnabled('personal_assistant'), true);
  assert.equal(isTemplateEnabled('customer_bot'), true);

  setRolloutForTests({ studyAssistant: true });
  assert.equal(isTemplateEnabled('study_assistant'), true);
  assert.deepEqual(
    galleryTemplates().map((item) => item.id),
    ['study_assistant'],
  );
  assert.equal(CAPABILITIES.document_tools.availability, 'available');
  assert.equal(RECIPES.study_assistant.available, true);
});

test('рецепт учебного помощника — только задаче, которой нужны документы', (t) => {
  t.after(() => setRolloutForTests(null));
  setRolloutForTests({ studyAssistant: true });
  assert.equal(
    acceptedRecipe('study_assistant', 'ready', ['text_generation', 'document_tools']),
    'study_assistant',
  );
  assert.equal(acceptedRecipe('study_assistant', 'ready', ['text_generation']), null);
  assert.equal(acceptedRecipe('study_assistant', 'not_supported', ['document_tools']), null);
  // Рецепты помощников требований не добавляют.
  assert.equal(
    acceptedRecipe('personal_assistant', 'ready', ['text_generation']),
    'personal_assistant',
  );
  assert.equal(isTemplateEnabled('weekly_content'), false);
});
