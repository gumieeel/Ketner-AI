import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeOutputCap,
  effectiveReasoningMode,
  isMaxModeAllowed,
  profileEffort,
  toProviderReasoning,
} from './reasoning-policy.js';
import { MODELS } from './models.js';

const STD = { standard: 'medium', max: 'xhigh' } as const;
const XH = { standard: 'xhigh', max: 'xhigh' } as const;

test('режим Max доступен только на Ultra (и VIP, у которого эффективный тариф Ultra)', () => {
  assert.equal(isMaxModeAllowed('ultra'), true);
  assert.equal(isMaxModeAllowed('pro'), false);
  assert.equal(isMaxModeAllowed('plus'), false);
  assert.equal(effectiveReasoningMode('max', 'ultra'), 'max');
  assert.equal(effectiveReasoningMode('max', 'pro'), 'standard');
  assert.equal(effectiveReasoningMode(undefined, 'ultra'), 'standard');
});

test('глубина по профилю: medium / xhigh, когда кредиты кончились — low', () => {
  assert.equal(profileEffort(STD, 'standard', 'normal'), 'medium');
  assert.equal(profileEffort(STD, 'max', 'normal'), 'xhigh');
  assert.equal(profileEffort(XH, 'standard', 'normal'), 'xhigh');
  assert.equal(profileEffort(STD, 'max', 'exhausted'), 'low');
});

test('xhigh уходит провайдеру как есть, а модели без xhigh получают ближайшую глубину', () => {
  assert.deepEqual(
    toProviderReasoning(
      { mandatory: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
      'xhigh',
    ),
    { effort: 'xhigh' },
  );
  assert.deepEqual(
    toProviderReasoning({ mandatory: true, efforts: ['low', 'medium', 'high'] }, 'xhigh'),
    { effort: 'high' },
  );
});

test('глубоким размышлениям не ставится короткий потолок ответа', () => {
  const base = {
    planMaxTokens: 16384,
    modelMaxOutputTokens: 32768,
    stage: 'normal' as const,
    level: 'simple' as const,
    heavyContext: false,
  };
  assert.equal(computeOutputCap({ ...base, effort: 'medium' }), 2048);
  assert.equal(computeOutputCap({ ...base, effort: 'xhigh' }), 16384);
});

test('каталог /api/meta отдаёт профиль размышлений моделей Pro и не показывает выключенную Gemini 4 Argon', () => {
  const opus = MODELS.find((m) => m.id === 'claude-opus-5.5');
  assert.deepEqual(opus?.reasoningEffort, { standard: 'medium', max: 'xhigh' });
  assert.equal('dailyLimits' in (opus ?? {}), false, 'дневных лимитов моделей больше нет');
  assert.equal(MODELS.find((m) => m.id === 'grok-4.7')?.name, 'Grok 4.7 xhigh');
  assert.equal(
    MODELS.some((m) => m.id === 'gemini-4-argon'),
    false,
  );
  assert.equal(
    MODELS.some((m) => m.id === 'gemini-3.8-flash'),
    false,
    'Gemini 3.8 Flash теперь только запасная',
  );
});
