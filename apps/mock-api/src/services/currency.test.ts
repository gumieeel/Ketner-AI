import assert from 'node:assert/strict';
import test from 'node:test';
import { CurrencyService } from './currency.js';
import { PLAN_ENTITLEMENTS } from './entitlement.js';
import { PLANS } from '../routes/billing.js';

test('CurrencyService: конвертация валют и динамическое обновление курса', () => {
  const initialRate = CurrencyService.getUsdToRubRate();
  assert.ok(initialRate > 0);

  CurrencyService.setUsdToRubRate(100);
  assert.equal(CurrencyService.getUsdToRubRate(), 100);

  // 1000 RUB / 100 = 10 USD
  assert.equal(CurrencyService.rubToUsd(1000), 10);
  // 10 USD * 100 = 1000 RUB
  assert.equal(CurrencyService.usdToRub(10), 1000);

  // Восстанавливаем курс
  CurrencyService.setUsdToRubRate(95);
  assert.equal(CurrencyService.getUsdToRubRate(), 95);
});

// Допущения расчёта (docs/models-and-pricing.md): налог 6%, Stripe 3.9% + $0.30 (карта, международная),
// комиссия пополнения OpenRouter 5.5%, субсидия Free-тира $3.01 на платящего (конверсия 5%, средний расход Free $0.15).
const TAX = 0.06;
const OPENROUTER_FEE = 1.055;
const FREE_SUBSIDY_PER_PAYER = 3.01;
const HARD_STOP_MULTIPLIER = 1.25; // services/budget-policy.ts: после 125% бюджета запросы отклоняются
const STARS_PAYOUT_USD = 0.013; // выплата разработчику за 1 Star
const STARS_BY_PLAN: Record<string, number> = { plus: 500, pro: 1350, ultra: 2650 };

function stripeNet(priceUsd: number): number {
  return priceUsd * (1 - TAX) - (priceUsd * 0.039 + 0.3);
}

test('Экономика тарифов: цены каталога в долларах и бюджет моделей не больше 45% цены', () => {
  assert.deepEqual(
    PLANS.map((p) => p.priceMonthly),
    [0, 9, 25, 49],
    'каталог должен быть в долларах: Free, Plus, Pro, Ultra',
  );

  for (const plan of PLANS) {
    const entitlement = PLAN_ENTITLEMENTS[plan.id];
    assert.ok(entitlement, `План ${plan.id} должен присутствовать в PLAN_ENTITLEMENTS`);
    if (plan.priceMonthly <= 0) continue;

    const ratio = entitlement.costBudget / plan.priceMonthly;
    assert.ok(
      ratio < 0.45,
      `Для тарифа ${plan.id}: costBudget=$${entitlement.costBudget} составляет ${(ratio * 100).toFixed(1)}% цены $${plan.priceMonthly}, ожидается < 45%`,
    );
    assert.ok(
      entitlement.premiumBudget <= entitlement.costBudget * 0.5,
      `Для тарифа ${plan.id}: квота премиум-моделей не должна съедать больше половины бюджета`,
    );
  }
});

test('Экономика тарифов: даже в худшем случае тариф прибылен', () => {
  for (const plan of PLANS) {
    if (plan.priceMonthly <= 0) continue;
    const { costBudget } = PLAN_ENTITLEMENTS[plan.id];
    const net = stripeNet(plan.priceMonthly);

    // Пользователь выбрал весь бюджет, платит картой, плюс доля Free-тира: маржа не меньше 20% цены.
    const atBudget = costBudget * OPENROUTER_FEE + FREE_SUBSIDY_PER_PAYER;
    assert.ok(
      net - atBudget >= plan.priceMonthly * 0.2,
      `Для тарифа ${plan.id}: чистыми $${net.toFixed(2)}, расход в худшем случае $${atBudget.toFixed(2)}, маржа ниже 20% цены`,
    );

    // Жёсткий предел (125% бюджета, дальше запросы отклоняются): тариф всё ещё не в минусе.
    const atCeiling = costBudget * HARD_STOP_MULTIPLIER * OPENROUTER_FEE + FREE_SUBSIDY_PER_PAYER;
    assert.ok(
      net - atCeiling > 0,
      `Для тарифа ${plan.id}: на пределе 125% бюджета расход $${atCeiling.toFixed(2)} превышает выручку $${net.toFixed(2)}`,
    );

    // Оплата Stars: приходит около 72% цены, но без учёта Free-тира тариф остаётся прибыльным.
    const starsNet = STARS_BY_PLAN[plan.id] * STARS_PAYOUT_USD * (1 - TAX);
    assert.ok(
      starsNet - costBudget * OPENROUTER_FEE > 0,
      `Для тарифа ${plan.id}: при оплате Stars ($${starsNet.toFixed(2)}) расход на бюджете $${(costBudget * OPENROUTER_FEE).toFixed(2)} убыточен`,
    );
  }
});

test('CurrencyService.calculatePlanCostBudget: считает от цены в долларах', () => {
  assert.equal(CurrencyService.calculatePlanCostBudget(25), 10);
  assert.equal(CurrencyService.calculatePlanCostBudget(49, 0.4), 19.6);
  assert.equal(CurrencyService.calculatePlanCostBudget(0), 0.2);
});
