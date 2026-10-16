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
  ULTRA_LIST_PRICE_USD,
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
    // Звёзды считаются от цены в долларах по курсу Stars: по тому же курсу это не меньше цены тарифа.
    const stars = calculateStars(plan.priceMonthly);
    assert.ok(
      stars * 0.015 >= plan.priceMonthly,
      `${plan.id}: ${stars} ⭐ дешевле $${plan.priceMonthly}`,
    );
    assert.ok(
      stars * 0.015 < plan.priceMonthly + 0.2,
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

test('pricing: цены на сайте (apps/web/.../plans.ts) совпадают с бэкендом', (t) => {
  // Сайт и сервер хранят каталог раздельно, и однажды они разошлись (доллары против рублей).
  // Тест читает исходник каталога сайта и сравнивает цены платных тарифов и скидочную цену Ultra.
  const webPlans = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../web/src/features/billing/plans.ts',
  );
  if (!existsSync(webPlans)) {
    t.skip('исходники сайта недоступны в этом окружении');
    return;
  }
  const source = readFileSync(webPlans, 'utf8');
  const priceOf = (id: string): number | undefined => {
    const block = source.match(
      new RegExp(`id: '${id}',[\\s\\S]*?priceMonthly: (\\d+(?:\\.\\d+)?)`),
    );
    return block ? Number(block[1]) : undefined;
  };
  assert.equal(priceOf('free'), PLAN_PRICE_USD.free);
  assert.equal(priceOf('plus'), PLAN_PRICE_USD.plus);
  assert.equal(priceOf('pro'), PLAN_PRICE_USD.pro);
  assert.equal(priceOf('ultra'), PLAN_PRICE_USD.ultra);
  assert.match(source, new RegExp(`originalPriceMonthly: ${ULTRA_LIST_PRICE_USD}`));
});
