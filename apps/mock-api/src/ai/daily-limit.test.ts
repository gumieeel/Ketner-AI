import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyDailyLimits, isDailyLimitReached } from './daily-limit.js';
import { ModelRegistry } from './model-registry.js';
import { UsageStore } from '../store/usage-store.js';
import { DAILY_MODEL_LIMITS, getDailyModelLimit, getDailyModelLimits } from '../services/daily-limits.js';

const registry = new ModelRegistry();

function newUsage(): UsageStore {
  return new UsageStore(join(mkdtempSync(join(tmpdir(), 'ketner-dl-')), 'usage.json'));
}

function use(usage: UsageStore, userId: string, modelId: string, times: number, ageHours = 0): void {
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

test('суточные лимиты: Plus, Pro и Ultra ограничены по моделям, Free — нет', () => {
  assert.equal(getDailyModelLimit('plus', 'gpt-6.1-sol'), 2);
  assert.equal(getDailyModelLimit('plus', 'ketner-pro'), 20);
  assert.equal(getDailyModelLimit('plus', 'gemini-3.7-flash'), 5);
  assert.equal(getDailyModelLimit('plus', 'gpt-5.6-luna-pro'), 10);
  assert.equal(getDailyModelLimit('plus', 'qwen3.8-27b'), 12);
  assert.equal(getDailyModelLimit('plus', 'ketner-mini'), null);
  assert.equal(getDailyModelLimit('pro', 'gpt-6.1-sol'), 6);
  assert.equal(getDailyModelLimit('pro', 'claude-opus-5.5'), 3);
  assert.equal(getDailyModelLimit('ultra', 'claude-opus-5.5'), 7);
  assert.equal(getDailyModelLimit('gpt-pro', 'claude-opus-5.5'), 3, 'старые тарифы получают лимиты Pro');
  assert.deepEqual(getDailyModelLimits('free'), {});
  assert.equal(Object.keys(DAILY_MODEL_LIMITS.plus).length, 5);
});

test('каждая модель с лимитом имеет запасную модель, а цепочка заканчивается моделью без лимита', () => {
  for (const id of Object.keys(DAILY_MODEL_LIMITS.plus)) {
    const chain = registry.getFallbackChain(id, 10);
    assert.ok(chain.length > 1, `${id}: нет запасной модели`);
    assert.equal(getDailyModelLimit('plus', chain.at(-1)!.id), null, `${id}: цепочка заканчивается моделью с лимитом`);
  }
  assert.equal(registry.get('gpt-6.1-sol')!.fallbackModelId, 'gpt-6-luna-pro');
  assert.equal(registry.get('gpt-5.6-luna-pro')!.fallbackModelId, 'ketner-mini');
  assert.equal(registry.get('qwen3.8-27b')!.fallbackModelId, 'qwen3.8-flash');
});

test('пока лимит не исчерпан, модель остаётся запрошенной', () => {
  const usage = newUsage();
  const sol = registry.get('gpt-6.1-sol')!;
  assert.equal(isDailyLimitReached(sol, 'plus', 'u1', usage, registry), false);
  const decision = applyDailyLimits(sol, 'plus', 'u1', usage, registry);
  assert.equal(decision.model.id, 'gpt-6.1-sol');
  assert.equal(decision.reason, null);
});

test('после лимита Sol отвечает GPT-6 Luna Pro, причина видна в routingReason', () => {
  const usage = newUsage();
  use(usage, 'u2', 'gpt-6.1-sol', 2);
  const decision = applyDailyLimits(registry.get('gpt-6.1-sol')!, 'plus', 'u2', usage, registry);
  assert.equal(decision.model.id, 'gpt-6-luna-pro');
  assert.match(decision.reason ?? '', /Daily limit reached for GPT-6\.1 Sol \(2\/day on plus\)/);
});

test('лимит считается по скользящим 24 часам: вчерашний запрос уже не в счёт', () => {
  const usage = newUsage();
  use(usage, 'u3', 'gpt-6.1-sol', 2, 25);
  const decision = applyDailyLimits(registry.get('gpt-6.1-sol')!, 'plus', 'u3', usage, registry);
  assert.equal(decision.model.id, 'gpt-6.1-sol');
});

test('лимит у каждого пользователя свой, а на тарифе без лимита замены нет', () => {
  const usage = newUsage();
  use(usage, 'u4', 'gpt-6.1-sol', 5);
  const sol = registry.get('gpt-6.1-sol')!;
  assert.equal(applyDailyLimits(sol, 'plus', 'u5', usage, registry).model.id, 'gpt-6.1-sol');
  assert.equal(applyDailyLimits(sol, 'pro', 'u4', usage, registry).model.id, 'gpt-6.1-sol');
});

test('Qwen 27B → Qwen3.8 Flash, Luna Pro → ketner-mini, Ketner Pro → Haiku', () => {
  const usage = newUsage();
  use(usage, 'u6', 'qwen3.8-27b', 12);
  use(usage, 'u6', 'gpt-5.6-luna-pro', 10);
  use(usage, 'u6', 'ketner-pro', 20);
  use(usage, 'u6', 'gemini-3.7-flash', 5);
  const pick = (id: string) => applyDailyLimits(registry.get(id)!, 'plus', 'u6', usage, registry).model.id;
  assert.equal(pick('qwen3.8-27b'), 'qwen3.8-flash');
  assert.equal(pick('gpt-5.6-luna-pro'), 'ketner-mini');
  assert.equal(pick('ketner-pro'), 'claude-haiku-5.5');
  assert.equal(pick('gemini-3.7-flash'), 'claude-haiku-5.5');
});

test('ошибочные и кэшированные ответы лимит не тратят, отменённые считаются', () => {
  const usage = newUsage();
  usage.recordUsage({ userId: 'u7', conversationId: 'c', modelId: 'gpt-6.1-sol', provider: 'openrouter', inputTokens: 1, outputTokens: 1, estimatedCost: 0, latencyMs: 1, status: 'error' });
  assert.equal(usage.getModelUsesLastDay('u7', ['gpt-6.1-sol']), 0);
  usage.recordUsage({ userId: 'u7', conversationId: 'c', modelId: 'gpt-6.1-sol', provider: 'openrouter', inputTokens: 1, outputTokens: 1, estimatedCost: 0.01, latencyMs: 1, status: 'cancelled' });
  assert.equal(usage.getModelUsesLastDay('u7', ['gpt-6.1-sol']), 1);
});

test('Pro и Ultra: у каждой модели с лимитом есть цепочка, которая заканчивается моделью без лимита', () => {
  for (const plan of ['pro', 'ultra'] as const) {
    for (const id of Object.keys(DAILY_MODEL_LIMITS[plan])) {
      const chain = registry.getFallbackChain(id, 10);
      assert.ok(chain.length > 1, `${plan}/${id}: нет запасной модели`);
      assert.equal(getDailyModelLimit(plan, chain.at(-1)!.id), null, `${plan}/${id}: цепочка заканчивается моделью с лимитом`);
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
    assert.ok(entry.reasoning.efforts.includes('xhigh'), `${id}: xhigh должен быть среди допустимых глубин`);
    assert.equal(entry.fallbackModelId, fallback, id);
  }
  // Gemini 4 Argon анонсирована, но в OpenRouter её нет: модель выключена и в каталог не попадает.
  assert.equal(registry.get('gemini-4-argon')?.enabled, false);
  // Claude Fable 5.1 убрана: отдельной записи нет, старый id ведёт на Opus.
  assert.equal(registry.get('claude-fable-5.1')?.id, 'claude-opus-5.5');
});
