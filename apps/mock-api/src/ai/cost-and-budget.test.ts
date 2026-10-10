import assert from 'node:assert/strict';
import test from 'node:test';
import { computeRequestCost, effectivePricing, isFreeEngine, UNDECLARED_PAID_ENGINE_PRICING } from './engine-pricing.js';
import { modelRegistry } from './model-registry.js';
import {
  BUDGET_HARD_STOP_RATIO,
  evaluateBudget,
} from '../services/budget-policy.js';
import { createStreamWatchdog } from './stream-watchdog.js';

test('стоимость от провайдера приоритетнее таблицы', () => {
  const mini = modelRegistry.resolve('ketner-mini');
  const r = computeRequestCost({
    model: mini,
    engineId: 'openai/gpt-6-luna',
    tokens: { inputTokens: 1000, outputTokens: 500 },
    providerCost: 0.00123,
  });
  assert.deepEqual(r, { usd: 0.00123, source: 'provider' });
});

test('в реестре нет бесплатных моделей: каждая стоит денег и попадает в учёт', () => {
  for (const entry of modelRegistry.getAll().filter((m) => m.id !== 'auto' && m.id !== 'nemotron-ultra')) {
    assert.ok(entry.pricing.inputPricePerMillion > 0, `${entry.id}: цена входа не задана`);
    assert.ok(entry.pricing.outputPricePerMillion > 0, `${entry.id}: цена выхода не задана`);
    assert.equal(isFreeEngine(entry.providerModelId), false, `${entry.id}: :free-модели общего пула не используются`);
  }
});

test('nemotron-ultra — бесплатная модель OpenRouter для анонимных пользователей', () => {
  const nemotron = modelRegistry.resolve('nemotron-ultra');
  assert.equal(nemotron.id, 'nemotron-ultra');
  assert.equal(nemotron.tier, 'free');
  assert.equal(isFreeEngine(nemotron.providerModelId), true);
});

test('модель с нулевой ценой в реестре (ошибка админа) считается по консервативной цене', () => {
  const mini = modelRegistry.resolve('ketner-mini');
  const zeroPriced = {
    ...mini,
    pricing: { ...mini.pricing, inputPricePerMillion: 0, outputPricePerMillion: 0, cachedInputPricePerMillion: 0 },
  };
  const r = computeRequestCost({
    model: zeroPriced,
    engineId: 'openai/gpt-6-luna',
    tokens: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
  });
  assert.equal(r.source, 'table');
  assert.equal(r.usd, Number((0.3 + 1.2).toFixed(6)));
  assert.equal(effectivePricing(zeroPriced, 'openai/gpt-6-luna'), UNDECLARED_PAID_ENGINE_PRICING);
});

test('настоящий :free движок стоит 0', () => {
  const mini = modelRegistry.resolve('ketner-mini');
  const zeroPriced = {
    ...mini,
    pricing: { ...mini.pricing, inputPricePerMillion: 0, outputPricePerMillion: 0, cachedInputPricePerMillion: 0 },
  };
  assert.equal(isFreeEngine('vendor/model:free'), true);
  const r = computeRequestCost({
    model: zeroPriced,
    engineId: 'vendor/model:free',
    tokens: { inputTokens: 5000, outputTokens: 2000 },
  });
  assert.equal(r.usd, 0);
});

test('платная модель считается по своей цене', () => {
  const sol = modelRegistry.resolve('gpt-6.1-sol');
  assert.equal(sol.pricing.inputPricePerMillion, 2);
  assert.equal(sol.pricing.outputPricePerMillion, 10);
  const r = computeRequestCost({
    model: sol,
    tokens: { inputTokens: 1_000_000, outputTokens: 100_000 },
  });
  assert.equal(r.usd, Number((2 + 1).toFixed(6)));
});

test('отрицательная или NaN стоимость провайдера игнорируется', () => {
  const sol = modelRegistry.resolve('gpt-6.1-sol');
  const tokens = { inputTokens: 1000, outputTokens: 1000 };
  assert.equal(computeRequestCost({ model: sol, tokens, providerCost: -1 }).source, 'table');
  assert.equal(computeRequestCost({ model: sol, tokens, providerCost: Number.NaN }).source, 'table');
});

test('бюджет: стадии normal → soft → exhausted → hard_stop', () => {
  assert.equal(evaluateBudget(0, 4).stage, 'normal');
  assert.equal(evaluateBudget(3.3, 4).stage, 'soft');
  assert.equal(evaluateBudget(4, 4).stage, 'exhausted');
  assert.equal(evaluateBudget(4 * BUDGET_HARD_STOP_RATIO, 4).stage, 'hard_stop');
  assert.equal(evaluateBudget(100, 0).stage, 'normal');
});

test('сторож: таймаут до первого токена, затем простой, непрерывный поток не обрывается', async () => {
  const fired: string[] = [];
  const quick = createStreamWatchdog({ firstTokenMs: 20, idleMs: 40, totalMs: 1000 }, (r) => fired.push(r));
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(fired, ['first_token']);
  assert.equal(quick.reason, 'first_token');

  const firedIdle: string[] = [];
  const idle = createStreamWatchdog({ firstTokenMs: 30, idleMs: 25, totalMs: 1000 }, (r) => firedIdle.push(r));
  idle.touch();
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(firedIdle, ['idle']);

  const firedLive: string[] = [];
  const live = createStreamWatchdog({ firstTokenMs: 30, idleMs: 30, totalMs: 1000 }, (r) => firedLive.push(r));
  for (let i = 0; i < 6; i++) {
    live.touch();
    await new Promise((r) => setTimeout(r, 15));
  }
  live.stop();
  assert.deepEqual(firedLive, [], 'поток, в котором токены идут, не должен обрываться (раньше резало на 25 с)');

  const firedTotal: string[] = [];
  const total = createStreamWatchdog({ firstTokenMs: 500, idleMs: 500, totalMs: 40 }, (r) => firedTotal.push(r));
  for (let i = 0; i < 5; i++) {
    total.touch();
    await new Promise((r) => setTimeout(r, 15));
  }
  assert.deepEqual(firedTotal, ['total']);
});
