import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { LEGACY_PLANS, PLANS } from '../routes/billing.js';
import { calculateStars } from '../telegram/bot.js';
import {
  LEGACY_PRICE_RUB,
  LEGACY_PRICE_USD,
  PLAN_PRICE_RUB,
  PLAN_PRICE_USD,
  STARS_OFFICIAL_USD_PER_STAR,
  planPriceCents,
  planPriceRub,
  planPriceUsd,
} from './pricing.js';

test('pricing: каталог тарифов берёт цены в долларах из единого источника', () => {
  for (const plan of PLANS) {
    assert.equal(plan.priceMonthly, PLAN_PRICE_USD[plan.id as keyof typeof PLAN_PRICE_USD]);
  }
  assert.deepEqual(
    PLANS.map((p) => p.priceMonthly),
    [0, 9, 25, 49],
  );
});

test('pricing: Stripe берёт центы, СБП рубли, Stars сходятся с долларовой ценой', () => {
  assert.equal(planPriceCents('plus'), 900);
  assert.equal(planPriceCents('pro'), 2500);
  assert.equal(planPriceCents('ultra'), 4900);

  assert.equal(planPriceRub('plus'), 890);
  assert.equal(planPriceRub('pro'), 2490);
  assert.equal(planPriceRub('ultra'), 4890);

  for (const plan of PLANS) {
    if (plan.priceMonthly <= 0) continue;
    // Доллары переводятся в звёзды по официальному курсу Telegram: по нему это не меньше цены
    // тарифа и дороже не больше чем на округление до 10 звёзд.
    const stars = calculateStars(plan.priceMonthly);
    assert.ok(
      stars * STARS_OFFICIAL_USD_PER_STAR >= plan.priceMonthly,
      `${plan.id}: ${stars} ⭐ дешевле $${plan.priceMonthly}`,
    );
    assert.ok(
      stars * STARS_OFFICIAL_USD_PER_STAR < plan.priceMonthly + 0.2,
      `${plan.id}: ${stars} ⭐ заметно дороже $${plan.priceMonthly}`,
    );
    assert.equal(stars % 10, 0, 'цена в звёздах округляется до 10');
  }
});

test('pricing: рублёвая сумма СБП не ниже цены в долларах по курсу 95 ₽/$', () => {
  for (const id of ['plus', 'pro', 'ultra'] as const) {
    assert.ok(
      PLAN_PRICE_RUB[id] / 95 >= PLAN_PRICE_USD[id],
      `${id}: ${PLAN_PRICE_RUB[id]} ₽ при курсе 95 меньше $${PLAN_PRICE_USD[id]}`,
    );
  }
});

test('pricing: старые тарифы платят прежние 1199 ₽ (≈ $12.62)', () => {
  assert.equal(planPriceUsd('gpt-pro'), LEGACY_PRICE_USD);
  assert.equal(planPriceRub('claude-pro'), LEGACY_PRICE_RUB);
  assert.equal(planPriceCents('gemini-pro'), 1262);
  for (const legacy of LEGACY_PLANS) {
    assert.equal(legacy.priceMonthly, LEGACY_PRICE_USD);
  }
});

test('pricing: сайт берёт цены пакетов из общего plan-facts.json, а не хранит свои', (t) => {
  // Подписки сняты с продажи: цены пакетов сверяет plan-facts.test.ts. Здесь следим, чтобы каталог
  // сайта снова не обзавёлся собственными ценами (раньше они расходились: доллары против рублей).
  const webPlans = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../web/src/features/billing/plans.ts',
  );
  if (!existsSync(webPlans)) {
    t.skip('исходники сайта недоступны в этом окружении');
    return;
  }
  const source = readFileSync(webPlans, 'utf8');
  assert.match(source, /plan-facts\.json/);
  assert.doesNotMatch(source, /priceMonthly|originalPriceMonthly/);
});
