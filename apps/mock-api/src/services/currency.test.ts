import assert from 'node:assert/strict';
import test from 'node:test';
import { CurrencyService } from './currency.js';
import { CRYPTO_PREMIUM_BONUS, PLAN_ENTITLEMENTS, withCryptoBonus } from './entitlement.js';
import { LEGACY_PLANS, PLANS } from '../routes/billing.js';
import { packStars, planStars } from '../telegram/bot.js';
import { StarsRateService } from '../telegram/stars-rate.js';
import type { PlanId } from '../types.js';
import { packWorstCaseCostUsd, planWorstCaseCostUsd } from './margin.js';
import {
  FREE_TIER_SUBSIDY_USD,
  modelSpendCostUsd,
  OPENROUTER_TOPUP_FEE,
  PACK_MAX_COST_SHARE,
  PAYMENT_NET_SHARE,
  PLAN_PRICE_USD,
  PREMIUM_PACKS,
  STARS_OFFICIAL_USD_PER_STAR,
  STARS_PAYOUT_USD,
  starsNetUsd,
  TAX_RATE,
} from './pricing.js';

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
const TAX = TAX_RATE;
const OPENROUTER_FEE = 1 + OPENROUTER_TOPUP_FEE;
const FREE_SUBSIDY_PER_PAYER = FREE_TIER_SUBSIDY_USD;
const HARD_STOP_MULTIPLIER = 1.25; // services/budget-policy.ts: после 125% бюджета запросы отклоняются

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
    // Квота премиум-моделей — часть бюджета, а не добавка к нему: даже у Pro и Ultra, где она основной
    // ресурс, на Ketner Pro и лёгкие модели остаётся не меньше четверти бюджета.
    assert.ok(
      entitlement.premiumBudget <= entitlement.costBudget * 0.75,
      `Для тарифа ${plan.id}: квота премиум-моделей не должна съедать больше 75% бюджета`,
    );
  }
});

test('Экономика тарифов: даже в худшем случае тариф прибылен', () => {
  for (const plan of PLANS) {
    if (plan.priceMonthly <= 0) continue;
    const { costBudget } = PLAN_ENTITLEMENTS[plan.id];
    const net = stripeNet(plan.priceMonthly);

    // Пользователь выбрал весь бюджет, платит картой, плюс доля Free-тира: маржа не меньше 15% цены.
    // (Free-тир теперь идёт на бесплатные эндпоинты, так что $3.01 — оценка сверху.)
    const atBudget = costBudget * OPENROUTER_FEE + FREE_SUBSIDY_PER_PAYER;
    assert.ok(
      net - atBudget >= plan.priceMonthly * 0.15,
      `Для тарифа ${plan.id}: чистыми $${net.toFixed(2)}, расход в худшем случае $${atBudget.toFixed(2)}, маржа ниже 15% цены`,
    );

    // Жёсткий предел (125% бюджета, дальше запросы отклоняются): тариф всё ещё не в минусе.
    const atCeiling = costBudget * HARD_STOP_MULTIPLIER * OPENROUTER_FEE + FREE_SUBSIDY_PER_PAYER;
    assert.ok(
      net - atCeiling > 0,
      `Для тарифа ${plan.id}: на пределе 125% бюджета расход $${atCeiling.toFixed(2)} превышает выручку $${net.toFixed(2)}`,
    );
  }
});

/** Сервис курса с заданным курсом цены (официальный или переопределённый STARS_USD_RATE). */
function starsAt(usdPerStar: number): StarsRateService {
  const rates = new StarsRateService({ usdPerStar });
  assert.equal(rates.rate.usdPerStar, usdPerStar);
  return rates;
}

// Любой курс цены, который принимает stars-rate.ts: от $0.008 до $0.03, включая официальный.
const STAR_RATES = [0.008, 0.013, 0.015, 0.018, STARS_OFFICIAL_USD_PER_STAR, 0.025, 0.03];

test('Ни один тариф не уходит в минус ни в одном канале: 125% бюджета, комиссии и доля Free-тира', () => {
  const margins: string[] = [];
  const check = (what: string, net: number, cost: number) => {
    margins.push(`${what}: ${(net - cost).toFixed(2)}`);
    assert.ok(
      net - cost >= 0,
      `${what}: чистыми $${net.toFixed(2)}, худший расход $${cost.toFixed(2)}`,
    );
  };

  for (const plan of [...PLANS, ...LEGACY_PLANS]) {
    if (plan.priceMonthly <= 0) continue;
    const planId = plan.id as PlanId;
    const worst = planWorstCaseCostUsd(planId);
    assert.ok(
      Math.abs(worst - (PLAN_ENTITLEMENTS[planId].costBudget * 1.25 * OPENROUTER_FEE + 3.01)) <
        1e-9,
    );
    check(`${planId} картой`, stripeNet(plan.priceMonthly), worst);
    check(
      `${planId} криптой с бонусом`,
      plan.priceMonthly * PAYMENT_NET_SHARE.crypto * (1 - TAX),
      planWorstCaseCostUsd(planId, { cryptoBonus: true }),
    );
  }

  // Звёзды: Telegram платит фиксированные $0.013 за звезду, а курс покупки плавает. При любом
  // курсе, который принимает stars-rate.ts, цена в звёздах не ниже точки безубыточности.
  for (const usdPerStar of STAR_RATES) {
    const rates = starsAt(usdPerStar);
    for (const planId of ['plus', 'pro', 'ultra'] as const) {
      const stars = planStars(planId, rates);
      check(
        `${planId} звёздами (${stars} ⭐, курс ${usdPerStar})`,
        starsNetUsd(stars),
        planWorstCaseCostUsd(planId),
      );
    }
    for (const pack of PREMIUM_PACKS) {
      const stars = packStars(pack, rates);
      check(
        `${pack.id} звёздами (${stars} ⭐, курс ${usdPerStar})`,
        starsNetUsd(stars),
        packWorstCaseCostUsd(pack),
      );
    }
  }
  for (const pack of PREMIUM_PACKS) {
    check(
      `${pack.id} криптой`,
      pack.priceUsd * PAYMENT_NET_SHARE.crypto * (1 - TAX),
      packWorstCaseCostUsd(pack),
    );
  }
  assert.ok(margins.length > 40, margins.join('\n'));
});

test('Цена в звёздах — по официальному курсу Telegram, но не ниже точки безубыточности', () => {
  const official = new StarsRateService();
  assert.equal(official.rate.source, 'official');
  assert.equal(official.rate.usdPerStar, STARS_OFFICIAL_USD_PER_STAR);
  // Звёзды тарифа по официальному курсу (460 / 1 260 / 2 460 ⭐) не покрывают худший расход с долей
  // Free-тира: Telegram отдаёт $0.013 из $0.02. Поэтому действует минимум 580 / 1 440 / 2 630 ⭐.
  assert.deepEqual(
    (['plus', 'pro', 'ultra'] as const).map((id) => [
      official.quote(PLAN_PRICE_USD[id]),
      planStars(id, official),
    ]),
    [
      [460, 580],
      [1260, 1440],
      [2460, 2630],
    ],
  );
  assert.ok(starsNetUsd(580) >= planWorstCaseCostUsd('plus'));
  assert.ok(
    starsNetUsd(570) < planWorstCaseCostUsd('plus'),
    '580 ⭐ — именно точка безубыточности',
  );
  // Пакеты по официальному курсу и так в плюсе: цена в звёздах равна цене в долларах.
  for (const pack of PREMIUM_PACKS) {
    assert.equal(packStars(pack, official), official.quote(pack.priceUsd), pack.id);
    assert.ok(Math.abs(official.toUsd(packStars(pack, official)) - pack.priceUsd) < 0.25, pack.id);
  }
  // Доля цены, которая доходит до нас со звёзд, — из выплаты и официальной цены, не отдельное число.
  assert.equal(PAYMENT_NET_SHARE.stars, STARS_PAYOUT_USD / STARS_OFFICIAL_USD_PER_STAR);
});

test('CurrencyService.calculatePlanCostBudget: считает от цены в долларах', () => {
  assert.equal(CurrencyService.calculatePlanCostBudget(25), 10);
  assert.equal(CurrencyService.calculatePlanCostBudget(49, 0.4), 19.6);
  assert.equal(CurrencyService.calculatePlanCostBudget(0), 0.2);
});

test('Пакеты премиум-квоты: цена не ниже себестоимости / 0.6 и прибыльны в любом канале оплаты', () => {
  assert.ok(PREMIUM_PACKS.length > 0);
  for (const pack of PREMIUM_PACKS) {
    // Себестоимость — квота с комиссией пополнения OpenRouter (пакет тратится только на модели).
    const cost = modelSpendCostUsd(pack.quotaUsd);
    assert.ok(
      pack.priceUsd >= cost / PACK_MAX_COST_SHARE,
      `${pack.id}: цена $${pack.priceUsd} ниже себестоимости $${cost.toFixed(2)} / ${PACK_MAX_COST_SHARE}`,
    );
    // Пакет выкуплен целиком: даже через Telegram Stars (≈72% цены) после налога остаётся прибыль.
    for (const [method, share] of Object.entries(PAYMENT_NET_SHARE)) {
      const net = pack.priceUsd * share * (1 - TAX);
      assert.ok(
        net - cost > 0,
        `${pack.id} через ${method}: чистыми $${net.toFixed(2)} не покрывают $${cost.toFixed(2)}`,
      );
    }
  }
  // Чем больше пакет, тем не дороже доллар квоты.
  const perQuota = PREMIUM_PACKS.map((p) => p.priceUsd / p.quotaUsd);
  assert.ok(perQuota.every((v, i) => i === 0 || v <= perQuota[i - 1] + 1e-9));
});

test('Бонус за оплату криптой: +15% к квоте покрывается разницей комиссий звёзд и крипты', () => {
  assert.equal(CRYPTO_PREMIUM_BONUS, 0.15);
  for (const plan of PLANS) {
    if (plan.priceMonthly <= 0) continue;
    const base = PLAN_ENTITLEMENTS[plan.id];
    const bonus = withCryptoBonus(base);
    const extra = bonus.premiumBudget - base.premiumBudget;
    assert.ok(Math.abs(extra - base.premiumBudget * CRYPTO_PREMIUM_BONUS) < 0.01, plan.id);
    assert.ok(
      Math.abs(bonus.costBudget - base.costBudget - extra) < 1e-9,
      'бюджет растёт на бонус',
    );

    const cryptoNet = plan.priceMonthly * PAYMENT_NET_SHARE.crypto * (1 - TAX);
    const starsNet = plan.priceMonthly * PAYMENT_NET_SHARE.stars * (1 - TAX);
    // Бонус (даже на жёстком пределе 125%) дешевле, чем разница комиссий звёзд и крипты.
    const bonusCost = extra * OPENROUTER_FEE * HARD_STOP_MULTIPLIER;
    assert.ok(
      bonusCost <= cryptoNet - starsNet,
      `${plan.id}: бонус $${bonusCost.toFixed(2)} дороже разницы комиссий $${(cryptoNet - starsNet).toFixed(2)}`,
    );
    for (const ratio of [1, HARD_STOP_MULTIPLIER]) {
      const cryptoMargin = cryptoNet - bonus.costBudget * ratio * OPENROUTER_FEE;
      const starsMargin = starsNet - base.costBudget * ratio * OPENROUTER_FEE;
      assert.ok(
        cryptoMargin >= starsMargin,
        `${plan.id}: крипта с бонусом ($${cryptoMargin.toFixed(2)}) хуже звёзд ($${starsMargin.toFixed(2)}) на ${ratio * 100}%`,
      );
      // И с учётом Free-тира крипта с бонусом в плюсе.
      assert.ok(cryptoMargin - FREE_SUBSIDY_PER_PAYER > 0, `${plan.id}: убыток на ${ratio * 100}%`);
    }
  }
});
