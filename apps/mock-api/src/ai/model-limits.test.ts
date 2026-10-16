import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyModelLimits, isModelLimitReached, modelLimitStatus } from './model-limits.js';
import { ModelRegistry } from './model-registry.js';
import { UsageStore } from '../store/usage-store.js';
import {
  DAILY_MODEL_LIMITS,
  getDailyModelLimit,
  getDailyModelLimits,
  getModelLimit,
} from '../services/daily-limits.js';

const registry = new ModelRegistry();

function newUsage(): UsageStore {
  return new UsageStore(join(mkdtempSync(join(tmpdir(), 'ketner-dl-')), 'usage.json'));
}

function use(
  usage: UsageStore,
  userId: string,
  modelId: string,
  times: number,
  ageHours = 0,
): void {
  for (let i = 0; i < times; i++) {
    const rec = usage.recordUsage({
      userId,
      conversationId: 'c',
      modelId,
      provider: 'openrouter',
      inputTokens: 1,
      outputTokens: 1,
      estimatedCost: 0.001,
      latencyMs: 1,
      status: 'success',
    });
    rec.createdAt = new Date(Date.now() - ageHours * 3_600_000).toISOString();
  }
}

test('суточные нормы: Plus, Pro и Ultra ограничены по моделям, Free — нет', () => {
  assert.equal(getDailyModelLimit('plus', 'gpt-6.1-sol'), 2);
  assert.equal(getDailyModelLimit('plus', 'ketner-pro'), 20);
  assert.equal(getDailyModelLimit('plus', 'gemini-3.7-flash'), 5);
  assert.equal(getDailyModelLimit('plus', 'gpt-5.6-luna-pro'), 10);
  assert.equal(getDailyModelLimit('plus', 'qwen3.8-27b'), 12);
  assert.equal(getDailyModelLimit('plus', 'ketner-mini'), null);
  assert.equal(getDailyModelLimit('pro', 'gpt-6.1-sol'), 6);
  assert.equal(getDailyModelLimit('pro', 'claude-opus-5.5'), 3);
  assert.equal(getDailyModelLimit('ultra', 'claude-opus-5.5'), 7);
  assert.equal(
    getDailyModelLimit('gpt-pro', 'claude-opus-5.5'),
    3,
    'старые тарифы получают лимиты Pro',
  );
  assert.deepEqual(getDailyModelLimits('free'), {});
  assert.equal(Object.keys(DAILY_MODEL_LIMITS.plus).length, 5);
});

test('каждая модель с лимитом имеет запасную модель, а цепочка заканчивается моделью без лимита', () => {
  for (const id of Object.keys(DAILY_MODEL_LIMITS.plus)) {
    const chain = registry.getFallbackChain(id, 10);
    assert.ok(chain.length > 1, `${id}: нет запасной модели`);
    assert.equal(
      getDailyModelLimit('plus', chain.at(-1)!.id),
      null,
      `${id}: цепочка заканчивается моделью с лимитом`,
    );
  }
  assert.equal(registry.get('gpt-6.1-sol')!.fallbackModelId, 'gpt-6-luna-pro');
  assert.equal(registry.get('gpt-5.6-luna-pro')!.fallbackModelId, 'ketner-mini');
  assert.equal(registry.get('qwen3.8-27b')!.fallbackModelId, 'qwen3.8-flash');
});

test('пока лимит не исчерпан, модель остаётся запрошенной', () => {
  const usage = newUsage();
  const sol = registry.get('gpt-6.1-sol')!;
  assert.equal(isModelLimitReached(sol, 'plus', 'u1', usage, registry), false);
  const decision = applyModelLimits(sol, 'plus', 'u1', usage, registry);
  assert.equal(decision.model.id, 'gpt-6.1-sol');
  assert.equal(decision.reason, null);
});

test('недельный пул: норма × 7, за сутки не больше 40% пула (но не меньше нормы)', () => {
  assert.deepEqual(getModelLimit('plus', 'gpt-6.1-sol'), { daily: 2, weeklyPool: 14, dailyCap: 5 });
  assert.deepEqual(getModelLimit('pro', 'claude-opus-5.5'), {
    daily: 3,
    weeklyPool: 21,
    dailyCap: 8,
  });
  assert.deepEqual(getModelLimit('pro', 'gpt-6-astra'), { daily: 1, weeklyPool: 7, dailyCap: 2 });
  assert.deepEqual(getModelLimit('ultra', 'claude-opus-5.5'), {
    daily: 7,
    weeklyPool: 49,
    dailyCap: 19,
  });
  assert.equal(getModelLimit('plus', 'ketner-mini'), null);
  // За 30 дней пул даёт столько же, сколько прежний суточный лимит: месячный бюджет не меняется.
  for (const [plan, byModel] of Object.entries(DAILY_MODEL_LIMITS)) {
    for (const id of Object.keys(byModel)) {
      const limit = getModelLimit(plan, id)!;
      assert.ok(Math.abs((limit.weeklyPool / 7) * 30 - limit.daily * 30) < 1e-9, `${plan}/${id}`);
      assert.ok(limit.dailyCap >= limit.daily && limit.dailyCap <= limit.weeklyPool);
    }
  }
});

test('квоту можно тратить неравномерно: за день больше прежней нормы, пока есть пул', () => {
  const usage = newUsage();
  // Раньше третий запрос Sol на Plus за сутки уходил на запасную модель; теперь до 5 в сутки.
  use(usage, 'u2', 'gpt-6.1-sol', 4);
  const sol = registry.get('gpt-6.1-sol')!;
  assert.equal(applyModelLimits(sol, 'plus', 'u2', usage, registry).model.id, 'gpt-6.1-sol');
  const status = modelLimitStatus(sol, 'plus', 'u2', usage, registry)!;
  assert.equal(status.dayUsed, 4);
  assert.equal(status.remaining, 1);
  assert.equal(status.binding, null);
});

test('суточная доля пула исчерпана: отвечает запасная модель, причина и время восстановления видны', () => {
  const usage = newUsage();
  use(usage, 'u2', 'gpt-6.1-sol', 5, 3);
  const sol = registry.get('gpt-6.1-sol')!;
  const decision = applyModelLimits(sol, 'plus', 'u2', usage, registry);
  assert.equal(decision.model.id, 'gpt-6-luna-pro');
  assert.match(
    decision.reason ?? '',
    /Daily share of the weekly pool used up for GPT-6\.1 Sol \(5\/day of 14\/week on plus\)/,
  );
  const status = decision.limited!.status;
  assert.equal(status.binding, 'day');
  // Запросы сделаны 3 часа назад: доля вернётся через 21 час.
  const restoresIn = Date.parse(status.dayRestoresAt!) - Date.now();
  assert.ok(Math.abs(restoresIn - 21 * 3_600_000) < 60_000, `через ${restoresIn} мс`);
});

test('недельный пул исчерпан: запасная модель до тех пор, пока старые запросы не выпадут из 7 дней', () => {
  const usage = newUsage();
  use(usage, 'u3', 'gpt-6.1-sol', 5, 6 * 24 + 1); // 6 суток назад
  use(usage, 'u3', 'gpt-6.1-sol', 5, 4 * 24);
  use(usage, 'u3', 'gpt-6.1-sol', 4, 2 * 24);
  const sol = registry.get('gpt-6.1-sol')!;
  const decision = applyModelLimits(sol, 'plus', 'u3', usage, registry);
  assert.equal(decision.model.id, 'gpt-6-luna-pro');
  assert.match(decision.reason ?? '', /Weekly pool used up for GPT-6\.1 Sol \(14\/week on plus\)/);
  const status = decision.limited!.status;
  assert.equal(status.binding, 'week');
  const restoresIn = Date.parse(status.weekRestoresAt!) - Date.now();
  assert.ok(Math.abs(restoresIn - 23 * 3_600_000) < 60_000, 'первые запросы выпадут через ~23 ч');

  // Запросы старше 7 дней в пул не входят.
  const fresh = newUsage();
  use(fresh, 'u3', 'gpt-6.1-sol', 14, 7 * 24 + 1);
  assert.equal(isModelLimitReached(sol, 'plus', 'u3', fresh, registry), false);
});

test('режим Max стоит 2 единицы пула: при остатке в 1 единицу отвечает запасная модель', () => {
  const usage = newUsage();
  use(usage, 'u8', 'claude-opus-5.5', 18);
  const opus = registry.get('claude-opus-5.5')!;
  assert.equal(isModelLimitReached(opus, 'ultra', 'u8', usage, registry, 'standard'), false);
  assert.equal(isModelLimitReached(opus, 'ultra', 'u8', usage, registry, 'max'), true);
});

test('лимит у каждого пользователя свой, а на тарифе без лимита замены нет', () => {
  const usage = newUsage();
  use(usage, 'u4', 'gpt-6.1-sol', 5);
  const sol = registry.get('gpt-6.1-sol')!;
  assert.equal(applyModelLimits(sol, 'plus', 'u5', usage, registry).model.id, 'gpt-6.1-sol');
  assert.equal(applyModelLimits(sol, 'pro', 'u4', usage, registry).model.id, 'gpt-6.1-sol');
});

test('Qwen 27B → Qwen3.8 Flash, Luna Pro → ketner-mini, Ketner Pro → Haiku', () => {
  const usage = newUsage();
  // Суточная доля пула: 40% от нормы × 7
  use(usage, 'u6', 'qwen3.8-27b', 33);
  use(usage, 'u6', 'gpt-5.6-luna-pro', 28);
  use(usage, 'u6', 'ketner-pro', 56);
  use(usage, 'u6', 'gemini-3.7-flash', 14);
  const pick = (id: string) =>
    applyModelLimits(registry.get(id)!, 'plus', 'u6', usage, registry).model.id;
  assert.equal(pick('qwen3.8-27b'), 'qwen3.8-flash');
  assert.equal(pick('gpt-5.6-luna-pro'), 'ketner-mini');
  assert.equal(pick('ketner-pro'), 'claude-haiku-5.5');
  assert.equal(pick('gemini-3.7-flash'), 'claude-haiku-5.5');
});

test('ошибочные и кэшированные ответы лимит не тратят, отменённые считаются', () => {
  const usage = newUsage();
  usage.recordUsage({
    userId: 'u7',
    conversationId: 'c',
    modelId: 'gpt-6.1-sol',
    provider: 'openrouter',
    inputTokens: 1,
    outputTokens: 1,
    estimatedCost: 0,
    latencyMs: 1,
    status: 'error',
  });
  assert.equal(usage.getModelUsesLastDay('u7', ['gpt-6.1-sol']), 0);
  usage.recordUsage({
    userId: 'u7',
    conversationId: 'c',
    modelId: 'gpt-6.1-sol',
    provider: 'openrouter',
    inputTokens: 1,
    outputTokens: 1,
    estimatedCost: 0.01,
    latencyMs: 1,
    status: 'cancelled',
  });
  assert.equal(usage.getModelUsesLastDay('u7', ['gpt-6.1-sol']), 1);
});

test('Pro и Ultra: у каждой модели с лимитом есть цепочка, которая заканчивается моделью без лимита', () => {
  for (const plan of ['pro', 'ultra'] as const) {
    for (const id of Object.keys(DAILY_MODEL_LIMITS[plan])) {
      const chain = registry.getFallbackChain(id, 10);
      assert.ok(chain.length > 1, `${plan}/${id}: нет запасной модели`);
      assert.equal(
        getDailyModelLimit(plan, chain.at(-1)!.id),
        null,
        `${plan}/${id}: цепочка заканчивается моделью с лимитом`,
      );
    }
  }
});

test('модели Pro и Ultra: id в OpenRouter, профиль размышлений и запасные модели', () => {
  const expect = {
    'claude-opus-5.5': ['anthropic/claude-opus-5.5', 'medium', 'claude-sonnet-5.5'],
    'claude-sonnet-5.5': ['anthropic/claude-sonnet-5.5', 'medium', 'ketner-pro'],
    'gpt-6-astra': ['openai/gpt-6-astra', 'medium', 'gpt-6.1-sol'],
    'grok-4.7': ['x-ai/grok-4.7', 'xhigh', 'ketner-pro'],
    'gpt-5.6-sol': ['openai/gpt-5.6-sol', 'medium', 'ketner-pro'],
    'gpt-5.6-terra': ['openai/gpt-5.6-terra', 'xhigh', 'gemini-3.8-flash'],
  } as const;
  for (const [id, [engine, standard, fallback]] of Object.entries(expect)) {
    const entry = registry.get(id)!;
    assert.equal(entry.providerModelId, engine, id);
    assert.equal(entry.requiredPlan, 'pro', id);
    assert.equal(entry.effortProfile?.standard, standard, id);
    assert.equal(entry.effortProfile?.max, 'xhigh', id);
    assert.ok(
      entry.reasoning.efforts.includes('xhigh'),
      `${id}: xhigh должен быть среди допустимых глубин`,
    );
    assert.equal(entry.fallbackModelId, fallback, id);
  }
  // Gemini 4 Argon анонсирована, но в OpenRouter её нет: модель выключена и в каталог не попадает.
  assert.equal(registry.get('gemini-4-argon')?.enabled, false);
  // Claude Fable 5.1 убрана: отдельной записи нет, старый id ведёт на Opus.
  assert.equal(registry.get('claude-fable-5.1')?.id, 'claude-opus-5.5');
});
