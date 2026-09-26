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

test('Экономика тарифов: costBudget < priceMonthly_USD * 0.50 для всех платных тарифов', () => {
  const rate = CurrencyService.getUsdToRubRate();

  for (const plan of PLANS) {
    const entitlement = PLAN_ENTITLEMENTS[plan.id];
    assert.ok(entitlement, `План ${plan.id} должен присутствовать в PLAN_ENTITLEMENTS`);

    if (plan.priceMonthly > 0) {
      const priceUsd = plan.priceMonthly / rate;
      const budgetRatio = entitlement.costBudget / priceUsd;

      // Бюджет себестоимости ИИ должен быть строго меньше 50% от выручки в USD
      assert.ok(
        budgetRatio < 0.50,
        `Для тарифа ${plan.id}: costBudget=$${entitlement.costBudget} составляет ${(budgetRatio * 100).toFixed(1)}% от выручки $${priceUsd.toFixed(2)}, ожидается < 50%`,
      );
    }
  }

  // Проверка конкретно Ultra тарифа (ранее было $40 при цене ₽2499)
  const ultraEntitlement = PLAN_ENTITLEMENTS.ultra;
  assert.ok(ultraEntitlement.costBudget <= 14.0, 'Бюджет Ultra должен быть в диапазоне $10-14');
  assert.ok(ultraEntitlement.costBudget >= 10.0, 'Бюджет Ultra должен быть в диапазоне $10-14');
});
