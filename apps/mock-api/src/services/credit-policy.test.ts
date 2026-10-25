import assert from 'node:assert/strict';
import test from 'node:test';
import { modelRegistry } from '../ai/model-registry.js';
import {
  canAfford,
  creditStageOf,
  EXHAUSTED_BELOW_USD,
  FREE_AGENT_MODEL_ID,
  FREE_CHAT_MODEL_ID,
  isAffordableFallback,
  isFreeModel,
  pickAffordable,
  requestPriceUsd,
} from './credit-policy.js';

const model = (id: string) => {
  const entry = modelRegistry.get(id);
  assert.ok(entry, `модель ${id} должна быть в реестре`);
  return entry;
};

test('ступень: меньше одного кредита — кредиты кончились', () => {
  assert.equal(creditStageOf(5), 'normal');
  assert.equal(creditStageOf(EXHAUSTED_BELOW_USD), 'normal');
  assert.equal(creditStageOf(EXHAUSTED_BELOW_USD - 1e-9), 'exhausted');
  assert.equal(creditStageOf(0), 'exhausted');
});

test('бесплатные модели — это :free-эндпоинты; они ничего не стоят', () => {
  const chat = model(FREE_CHAT_MODEL_ID);
  const code = model(FREE_AGENT_MODEL_ID);
  assert.equal(isFreeModel(chat), true);
  assert.equal(isFreeModel(code), true);
  assert.equal(isFreeModel(model('ketner-mini')), false);
  assert.equal(requestPriceUsd(chat, 'standard'), 0);
  assert.equal(canAfford(chat, 0), true);
});

test('цена запроса: дороже у старших моделей и в режиме Max', () => {
  const mini = requestPriceUsd(model('ketner-mini'), 'standard');
  const sonnet = requestPriceUsd(model('claude-sonnet-5.5'), 'standard');
  const opus = requestPriceUsd(model('claude-opus-5.5'), 'standard');
  assert.ok(mini > 0 && mini < sonnet && sonnet < opus);
  assert.ok(requestPriceUsd(model('claude-opus-5.5'), 'max') > opus);
});

test('canAfford сравнивает остаток с ценой типичного запроса', () => {
  const opus = model('claude-opus-5.5');
  const price = requestPriceUsd(opus, 'standard');
  assert.equal(canAfford(opus, price, 'standard'), true);
  assert.equal(canAfford(opus, price - 1e-6, 'standard'), false);
  assert.equal(canAfford(opus, price, 'max'), false);
});

test('pickAffordable оставляет запрошенную модель, пока кредитов хватает', () => {
  const pick = pickAffordable(model('claude-sonnet-5.5'), {
    balanceUsd: 10,
    plan: 'pro',
    registry: modelRegistry,
  });
  assert.equal(pick.model.id, 'claude-sonnet-5.5');
  assert.equal(pick.reason, null);
});

test('pickAffordable: на дорогую модель не хватает — отвечает более дешёвая', () => {
  const opus = model('claude-opus-5.5');
  const balance = requestPriceUsd(opus, 'standard') / 2;
  const pick = pickAffordable(opus, {
    balanceUsd: balance,
    plan: 'ultra',
    registry: modelRegistry,
  });
  assert.notEqual(pick.model.id, opus.id);
  assert.ok(canAfford(pick.model, balance));
  assert.match(pick.reason ?? '', /Not enough credits|Credits used up/);
});

test('pickAffordable: кредиты кончились — отвечает бесплатная модель чата или кода', () => {
  const chat = pickAffordable(model('claude-sonnet-5.5'), {
    balanceUsd: 0,
    plan: 'pro',
    registry: modelRegistry,
  });
  assert.equal(chat.model.id, FREE_CHAT_MODEL_ID);
  assert.match(chat.reason ?? '', /Credits used up/);

  const code = pickAffordable(model('claude-sonnet-5.5'), {
    balanceUsd: 0,
    plan: 'pro',
    surface: 'code',
    registry: modelRegistry,
  });
  assert.equal(code.model.id, FREE_AGENT_MODEL_ID);
});

test('pickAffordable уважает canUse: недоступную модель не выбирает', () => {
  const pick = pickAffordable(model('ketner-mini'), {
    balanceUsd: 0,
    plan: 'free',
    registry: modelRegistry,
    canUse: (candidate) => candidate.id !== FREE_CHAT_MODEL_ID,
  });
  // Бесплатной модели чата нельзя, остаётся только запрошенная: не хуже, чем отказ.
  assert.notEqual(pick.model.id, FREE_CHAT_MODEL_ID);
});

test('запасная модель при сбое: платная — только если на неё хватает кредитов', () => {
  const sonnet = model('claude-sonnet-5.5');
  assert.equal(isAffordableFallback(sonnet, 0), false);
  assert.equal(isAffordableFallback(sonnet, 10), true);
  assert.equal(isAffordableFallback(model(FREE_CHAT_MODEL_ID), 0), true);
});
