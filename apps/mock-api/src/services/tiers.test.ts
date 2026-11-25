import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GRACE_RATE,
  NO_TIER_BUILD_ALLOWANCE,
  SUBSCRIPTION_TRIAL_DAYS,
  TIER_IDS,
  TIERS,
  isTierId,
  requestLimit,
  tierById,
  tierFor,
  tierMargin,
  usageState,
} from './tiers.js';

test('каталог: утверждённые цены, объёмы и помощь с подключением', () => {
  assert.deepEqual(
    TIERS.map((tier) => [
      tier.id,
      tier.priceUsd,
      tier.activeSolutions,
      tier.monthlyRequests,
      tier.externalServices,
    ]),
    [
      // Start: 1 внешний сервис — решение владельца 23.11.2026 (было 0).
      ['start', 10, 1, 1_000, 1],
      ['growth', 29, 3, 5_000, 2],
      ['business', 89, 10, 20_000, 5],
      ['scale', 235, 25, 60_000, 15],
    ],
  );
  assert.deepEqual(
    TIERS.map((tier) => tier.integrationHelp),
    [
      { kind: 'widget_install' },
      { kind: 'hours', hoursPerMonth: 2 },
      { kind: 'hours', hoursPerMonth: 4 },
      { kind: 'hours', hoursPerMonth: 4 },
    ],
  );
  assert.deepEqual(
    [...TIER_IDS],
    TIERS.map((tier) => tier.id),
  );
  assert.equal(GRACE_RATE, 0.1);
  assert.equal(SUBSCRIPTION_TRIAL_DAYS, 0, 'пробный период выключен');
});

test('каталог: каждый следующий тариф не меньше предыдущего ни по одной величине', () => {
  for (let i = 1; i < TIERS.length; i += 1) {
    const [prev, next] = [TIERS[i - 1]!, TIERS[i]!];
    assert.ok(next.priceUsd > prev.priceUsd, next.id);
    assert.ok(next.activeSolutions >= prev.activeSolutions, next.id);
    assert.ok(next.monthlyRequests >= prev.monthlyRequests, next.id);
    assert.ok(next.externalServices >= prev.externalServices, next.id);
    assert.ok(next.buildAllowanceCredits >= prev.buildAllowanceCredits, next.id);
  }
  assert.ok(TIERS[0]!.buildAllowanceCredits >= NO_TIER_BUILD_ALLOWANCE.monthlyCredits);
});

test('id тарифа: проверка и поиск', () => {
  assert.equal(isTierId('growth'), true);
  assert.equal(isTierId('pro'), false);
  assert.equal(isTierId(undefined), false);
  assert.equal(tierById('scale').name, 'Scale');
  assert.throws(() => tierById('pro' as never), /unknown tier/);
});

test('объём: 80% — предупреждение, 100% — льготный, 110% — режим заявок', () => {
  const start = tierById('start');
  assert.equal(requestLimit(start), 1_100);
  assert.equal(requestLimit(tierById('growth')), 5_500);
  assert.equal(usageState(start, 0), 'ok');
  assert.equal(usageState(start, 799), 'ok');
  assert.equal(usageState(start, 800), 'warning');
  assert.equal(usageState(start, 999), 'warning');
  assert.equal(usageState(start, 1_000), 'grace');
  assert.equal(usageState(start, 1_099), 'grace');
  assert.equal(usageState(start, 1_100), 'leads_only');
  assert.equal(usageState(start, 5_000), 'leads_only');
});

test('смета: наименьший тариф, покрывающий все три величины', () => {
  assert.equal(
    tierFor({ activeSolutions: 1, monthlyRequests: 300, externalServices: 0 })?.id,
    'start',
  );
  assert.equal(
    tierFor({ activeSolutions: 1, monthlyRequests: 1_001, externalServices: 0 })?.id,
    'growth',
  );
  assert.equal(
    tierFor({ activeSolutions: 1, monthlyRequests: 100, externalServices: 1 })?.id,
    'start',
  );
  assert.equal(
    tierFor({ activeSolutions: 1, monthlyRequests: 100, externalServices: 2 })?.id,
    'growth',
  );
  assert.equal(
    tierFor({ activeSolutions: 4, monthlyRequests: 100, externalServices: 0 })?.id,
    'business',
  );
  assert.equal(
    tierFor({ activeSolutions: 25, monthlyRequests: 60_000, externalServices: 15 })?.id,
    'scale',
  );
  assert.equal(tierFor({ activeSolutions: 26, monthlyRequests: 1, externalServices: 0 }), null);
});

test('маржа воспроизводит таблицу раздела 2.3 документа', () => {
  const round = (value: number) => Math.round(value * 100) / 100;
  const expected: Record<
    string,
    { card: [number, number, number]; crypto: [number, number, number] }
  > = {
    // Start: 1 внешний сервис с 23.11.2026 (+$2 инфраструктуры).
    start: { card: [4.04, 3.19, 2.67], crypto: [4.79, 3.95, 3.42] },
    growth: { card: [16.14, 11.92, 9.28], crypto: [17.6, 13.38, 10.75] },
    business: { card: [53.32, 36.44, 25.89], crypto: [57.05, 40.17, 29.62] },
    scale: { card: [137.95, 87.31, 55.66], crypto: [147.16, 96.52, 64.87] },
  };
  for (const tier of TIERS) {
    for (const channel of ['card', 'crypto'] as const) {
      const margins = [0.0004, 0.0012, 0.0017].map((cost) =>
        round(tierMargin(tier, channel, cost).marginUsd),
      );
      assert.deepEqual(margins, expected[tier.id]![channel], `${tier.id} ${channel}`);
    }
  }
});

test('маржа: при замеренной цене не меньше половины цены (Start — 40%), в худшем случае — положительная', () => {
  for (const tier of TIERS) {
    const measured = tierMargin(tier, 'card', 0.0004).marginUsd;
    // Start с 1 внешним сервисом (решение владельца 23.11.2026): $2 инфраструктуры на сервис
    // снижают маржу до 40% при замеренной цене — принято осознанно, проверяем, что не ниже.
    const floor = tier.id === 'start' ? 0.4 : 0.5;
    assert.ok(measured / tier.priceUsd >= floor, `${tier.id}: ${measured}`);
    const worst = tierMargin(tier, 'card', 0.0017).marginUsd;
    // Худший случай — ещё и весь бесплатный лимит создания (раздел 4).
    assert.ok(worst - tier.buildAllowanceCredits / 1000 > 0, `${tier.id}: ${worst}`);
  }
});
