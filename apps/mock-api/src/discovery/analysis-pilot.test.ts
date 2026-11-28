/**
 * Пилот анализа v2 (B6-pilot, docs/ANALYSIS_V2.md): для аккаунтов из пилота поиск возможностей —
 * Claude Sonnet 5.5 (effort medium) с промптом v2; остальные — без изменений.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { analysisV2PilotFor, setAnalysisV2PilotForTests } from './pilot.js';
import { estimateStages, PILOT_DISCOVERY, stagePolicy } from './model-policy.js';
import { discoverySystemPrompt } from './prompts.js';

test('политика: поиск возможностей в пилоте — Sonnet medium; разбор и план — как у режима', () => {
  for (const language of ['ru', 'en'] as const) {
    const current = stagePolicy('free', 'discovery', language);
    assert.equal(current.modelId, 'ketner-mini');
    assert.equal(current.reasoningEffort, 'low');
    const pilot = stagePolicy('free', 'discovery', language, undefined, { pilot: true });
    assert.equal(pilot.modelId, PILOT_DISCOVERY.modelId);
    assert.equal(pilot.modelId, 'claude-sonnet-5.5');
    assert.equal(pilot.reasoningEffort, 'medium');
    assert.equal(pilot.maxOutputTokens, 9_500);
    assert.ok(pilot.capUsd > current.capUsd * 10, 'потолок пилота — потолок Sonnet');
    for (const stage of ['context', 'plan'] as const) {
      assert.deepEqual(
        stagePolicy('free', stage, language, undefined, { pilot: true }),
        stagePolicy('free', stage, language),
        stage,
      );
    }
  }
  // Платный режим в пилоте тоже ищет возможности на Sonnet.
  assert.equal(
    stagePolicy('paid', 'discovery', 'ru', undefined, { pilot: true }).modelId,
    'claude-sonnet-5.5',
  );
  assert.ok(
    estimateStages('free', ['discovery'], 'ru', undefined, { pilot: true }).maxUsd >
      estimateStages('free', ['discovery'], 'ru').maxUsd,
  );
});

test('промпт пилота: процесс вместо чат-бота, порядок по ценности, «скоро» честно; текущий не меняется', () => {
  for (const language of ['ru', 'en'] as const) {
    const current = discoverySystemPrompt(language, 'catalog');
    const pilot = discoverySystemPrompt(language, 'catalog', 'pilot');
    assert.notEqual(pilot, current);
    assert.equal(discoverySystemPrompt(language, 'catalog', 'current'), current);
    if (language === 'ru') {
      assert.match(current, /Порядок — от самых полезных и простых в старте/);
      assert.match(current, /Не обещай автоматизацию, которой нет в каталоге/);
      assert.doesNotMatch(pilot, /простых в старте/);
      assert.doesNotMatch(pilot, /Не обещай автоматизацию, которой нет в каталоге/);
      assert.match(pilot, /по ценности для этого бизнеса/);
      assert.match(pilot, /событие → шаги → результат/);
      assert.match(pilot, /Сервер пометит их «скоро»/);
    } else {
      assert.doesNotMatch(pilot, /easiest to start/);
      assert.match(pilot, /Order by value to this business/);
      assert.match(pilot, /trigger → steps → result/);
      assert.match(pilot, /The server marks them «soon»/);
    }
  }
});

test('список пилота: владелец в коде, гостей нет, список подменяется только в тестах', (t) => {
  t.after(() => setAnalysisV2PilotForTests(null));
  assert.equal(analysisV2PilotFor('c4b78d88-6aee-4183-bd19-33a40e9ffece'), true);
  assert.equal(analysisV2PilotFor('someone-else'), false);
  assert.equal(analysisV2PilotFor(null), false);
  assert.equal(analysisV2PilotFor('guest_abc'), false);
  setAnalysisV2PilotForTests(['user-x']);
  assert.equal(analysisV2PilotFor('user-x'), true);
  assert.equal(analysisV2PilotFor('c4b78d88-6aee-4183-bd19-33a40e9ffece'), false);
});
