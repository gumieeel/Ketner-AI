import assert from 'node:assert/strict';
import test from 'node:test';
import { CurrencyService } from './currency.js';
import {
  CRYPTO_BONUS_CREDITS,
  PLAN_ENTITLEMENTS,
  cryptoBonusCredits,
  planCreditsUsd,
  toUsd,
} from './entitlement.js';
import { LEGACY_PLANS, PLANS } from '../routes/billing.js';
import { planStars } from '../telegram/bot.js';
import { StarsRateService } from '../telegram/stars-rate.js';
import type { PlanId } from '../types.js';
import {
  packListStars,
  packMinStars,
  packProfitUsd,
  planStarsWorstCaseCostUsd,
  planWorstCaseCostUsd,
  trialBreakEvenConversion,
} from './margin.js';
import {
  CREDIT_PACKS,
  FREE_TIER_SUBSIDY_USD,
  OPENROUTER_TOPUP_FEE,
  PAYMENT_NET_SHARE,
  PLAN_PRICE_USD,
  STARS_OFFICIAL_USD_PER_STAR,
  STARS_PAYOUT_USD,
  packCryptoBonusCredits,
  packPricePerThousand,
  starsNetUsd,
  TAX_RATE,
  TRIAL_COST_USD,
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
// Расход платящего ограничен выдачей кредитов: 1 кредит = $0.001 себестоимости, дальше отвечает бесплатная модель.
const TAX = TAX_RATE;
const OPENROUTER_FEE = 1 + OPENROUTER_TOPUP_FEE;
const FREE_SUBSIDY_PER_PAYER = FREE_TIER_SUBSIDY_USD;

function stripeNet(priceUsd: number): number {
  return priceUsd * (1 - TAX) - (priceUsd * 0.039 + 0.3);
}

test('Экономика тарифов: цены каталога в долларах и выдача кредитов не больше 45% цены', () => {
  assert.deepEqual(
    PLANS.map((p) => p.priceMonthly),
    [0, 9, 25, 49],
    'каталог должен быть в долларах: Free, Plus, Pro, Ultra',
  );

  for (const plan of PLANS) {
    const entitlement = PLAN_ENTITLEMENTS[plan.id];
    assert.ok(entitlement, `План ${plan.id} должен присутствовать в PLAN_ENTITLEMENTS`);
    if (plan.priceMonthly <= 0) continue;

    const credits = planCreditsUsd(plan.id);
    assert.equal(credits, toUsd(entitlement.monthlyCredits));
    const ratio = credits / plan.priceMonthly;
    assert.ok(
      ratio < 0.45,
      `Для тарифа ${plan.id}: выдача ${entitlement.monthlyCredits} кредитов = $${credits} составляет ${(ratio * 100).toFixed(1)}% цены $${plan.priceMonthly}, ожидается < 45%`,
    );
  }
  // Чем дороже тариф, тем больше кредитов.
  const monthly = PLANS.map((p) => PLAN_ENTITLEMENTS[p.id].monthlyCredits);
  assert.deepEqual(
    monthly,
    [...monthly].sort((x, y) => x - y),
  );
});

test('Экономика тарифов: даже в худшем случае тариф прибылен', () => {
  for (const plan of PLANS) {
    if (plan.priceMonthly <= 0) continue;
    const credits = planCreditsUsd(plan.id);
    const net = stripeNet(plan.priceMonthly);

    // Пользователь потратил все кредиты, платит картой, плюс доля Free-тира: маржа не меньше 15% цены.
    // (Free-тир идёт на бесплатные эндпоинты, так что $3.01 — оценка сверху.)
    const atLimit = credits * OPENROUTER_FEE + FREE_SUBSIDY_PER_PAYER;
    assert.ok(
      net - atLimit >= plan.priceMonthly * 0.15,
      `Для тарифа ${plan.id}: чистыми $${net.toFixed(2)}, расход в худшем случае $${atLimit.toFixed(2)}, маржа ниже 15% цены`,
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

test('Ни один тариф не уходит в минус ни в одном канале: все кредиты и комиссии', () => {
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
    assert.ok(Math.abs(worst - (planCreditsUsd(planId) * OPENROUTER_FEE + 3.01)) < 1e-9);
    assert.ok(
      Math.abs(
        planWorstCaseCostUsd(planId, { cryptoBonus: true }) -
          ((planCreditsUsd(planId) + toUsd(cryptoBonusCredits(planId))) * OPENROUTER_FEE + 3.01),
      ) < 1e-9,
    );
    check(`${planId} картой`, stripeNet(plan.priceMonthly), worst);
    check(
      `${planId} криптой с бонусом`,
      plan.priceMonthly * PAYMENT_NET_SHARE.crypto * (1 - TAX),
      planWorstCaseCostUsd(planId, { cryptoBonus: true }),
    );
  }

  // Звёзды: Telegram платит фиксированные $0.013 за звезду. Тариф в звёздах продаётся за цену
  // тарифа по официальному курсу, поэтому худший случай считается без доли Free-тира (см.
  // services/margin.ts). При любом курсе, который принимает stars-rate.ts, — не в минусе.
  for (const usdPerStar of STAR_RATES) {
    const rates = starsAt(usdPerStar);
    for (const planId of ['plus', 'pro', 'ultra'] as const) {
      const stars = planStars(planId, rates);
      const worst = planStarsWorstCaseCostUsd(planId);
      assert.ok(Math.abs(worst - planWorstCaseCostUsd(planId) + FREE_TIER_SUBSIDY_USD) < 1e-9);
      check(`${planId} звёздами (${stars} ⭐, курс ${usdPerStar})`, starsNetUsd(stars), worst);
    }
  }
  assert.ok(margins.length >= 30, margins.join('\n'));
});

test('Цена в звёздах — цена тарифа по официальному курсу Telegram (как картой)', () => {
  const official = new StarsRateService();
  assert.equal(official.rate.source, 'official');
  assert.equal(official.rate.usdPerStar, STARS_OFFICIAL_USD_PER_STAR);
  // Plus $9 = 460 ⭐, Pro $25 = 1 260 ⭐, Ultra $49 = 2 460 ⭐: минимум без убытка ниже, не мешает.
  for (const id of ['plus', 'pro', 'ultra'] as const) {
    const stars = planStars(id, official);
    assert.equal(stars, official.quote(PLAN_PRICE_USD[id]), id);
    // Дороже цены тарифа только на округление до 10 звёзд (≈ $0.20).
    assert.ok(official.toUsd(stars) - PLAN_PRICE_USD[id] < 0.2, id);
  }
  assert.deepEqual(
    (['plus', 'pro', 'ultra'] as const).map((id) => planStars(id, official)),
    [460, 1260, 2460],
  );
  // Худший случай без доли Free-тира — в плюсе: Plus +$2.46, Pro +$3.79, Ultra +$6.85.
  assert.deepEqual(
    (['plus', 'pro', 'ultra'] as const).map((id) =>
      Number((starsNetUsd(planStars(id, official)) - planStarsWorstCaseCostUsd(id)).toFixed(2)),
    ),
    [2.46, 3.79, 6.85],
  );
  // Минимум защищает от слишком дорогого курса в STARS_USD_RATE: при $0.03 Pro стоил бы 840 ⭐.
  const expensive = starsAt(0.03);
  assert.equal(expensive.quote(25), 840);
  assert.equal(planStars('pro', expensive), 950);
  assert.ok(starsNetUsd(950) >= planStarsWorstCaseCostUsd('pro'));
  assert.ok(starsNetUsd(940) < planStarsWorstCaseCostUsd('pro'), '950 ⭐ — точка безубыточности');
  // У Plus кредитов немного: даже при $0.03 его цена (300 ⭐) выше точки безубыточности.
  assert.equal(planStars('plus', expensive), 300);
  assert.ok(starsNetUsd(300) >= planStarsWorstCaseCostUsd('plus'));
  // Доля цены, которая доходит до нас со звёзд, — из выплаты и официальной цены, не отдельное число.
  assert.equal(PAYMENT_NET_SHARE.stars, STARS_PAYOUT_USD / STARS_OFFICIAL_USD_PER_STAR);
});

test('CurrencyService.calculatePlanCostBudget: считает от цены в долларах', () => {
  assert.equal(CurrencyService.calculatePlanCostBudget(25), 10);
  assert.equal(CurrencyService.calculatePlanCostBudget(49, 0.4), 19.6);
  assert.equal(CurrencyService.calculatePlanCostBudget(0), 0.2);
});

test('Бонус за оплату криптой: дополнительные кредиты покрываются разницей комиссий звёзд и крипты', () => {
  for (const plan of PLANS) {
    if (plan.priceMonthly <= 0) continue;
    const base = PLAN_ENTITLEMENTS[plan.id];
    const bonus = cryptoBonusCredits(plan.id);
    assert.equal(bonus, CRYPTO_BONUS_CREDITS[plan.id]);
    assert.ok(bonus > 0, `${plan.id}: бонус за крипту должен быть`);
    assert.ok(
      bonus <= base.monthlyCredits * 0.15,
      `${plan.id}: бонус ${bonus} кредитов больше 15% месячной выдачи ${base.monthlyCredits}`,
    );

    const baseUsd = planCreditsUsd(plan.id);
    const bonusUsd = toUsd(bonus);
    const cryptoNet = plan.priceMonthly * PAYMENT_NET_SHARE.crypto * (1 - TAX);
    const starsNet = plan.priceMonthly * PAYMENT_NET_SHARE.stars * (1 - TAX);
    // Бонус дешевле, чем разница комиссий звёзд и крипты.
    const bonusCost = bonusUsd * OPENROUTER_FEE;
    assert.ok(
      bonusCost <= cryptoNet - starsNet,
      `${plan.id}: бонус $${bonusCost.toFixed(2)} дороже разницы комиссий $${(cryptoNet - starsNet).toFixed(2)}`,
    );
    const cryptoMargin = cryptoNet - (baseUsd + bonusUsd) * OPENROUTER_FEE;
    const starsMargin = starsNet - baseUsd * OPENROUTER_FEE;
    assert.ok(
      cryptoMargin >= starsMargin,
      `${plan.id}: крипта с бонусом ($${cryptoMargin.toFixed(2)}) хуже звёзд ($${starsMargin.toFixed(2)})`,
    );
    // И с учётом Free-тира крипта с бонусом в плюсе.
    assert.ok(cryptoMargin - FREE_SUBSIDY_PER_PAYER > 0, `${plan.id}: убыток`);
  }
});

test('Экономика пакетов: ни один пакет не уходит в минус ни в одном канале', () => {
  for (const pack of CREDIT_PACKS) {
    for (const channel of ['stars', 'crypto', 'card'] as const) {
      const profit = packProfitUsd(pack, channel);
      assert.ok(
        profit > 0,
        `${pack.id} / ${channel}: прибыль $${profit.toFixed(2)} не положительна`,
      );
    }
    // Звёзды считаются по официальному курсу, но не дешевле точки безубыточности.
    assert.ok(
      packListStars(pack) >= packMinStars(pack),
      `${pack.id}: цена в звёздах ниже точки безубыточности`,
    );
  }
});

test('Экономика пакетов: маржа в звёздах 10–15% на малых пакетах, на $100 — около нуля по решению владельца', () => {
  const margin = (pack: (typeof CREDIT_PACKS)[number]) =>
    packProfitUsd(pack, 'stars') / pack.priceUsd;
  for (const pack of CREDIT_PACKS.filter((item) => item.priceUsd <= 50)) {
    assert.ok(margin(pack) >= 0.1, `${pack.id}: маржа ${(margin(pack) * 100).toFixed(1)}% < 10%`);
  }
  const big = CREDIT_PACKS.find((item) => item.priceUsd === 100)!;
  assert.ok(
    margin(big) > 0 && margin(big) < 0.02,
    `$100: маржа ${(margin(big) * 100).toFixed(2)}%`,
  );
  assert.ok(packProfitUsd(big, 'stars') < 1, '$100 в звёздах почти не приносит прибыли');
});

test('Экономика пакетов: скидка за объём — цена тысячи кредитов падает, пакет $100 на 20% дешевле пакета $5', () => {
  const prices = CREDIT_PACKS.map(packPricePerThousand);
  for (let i = 1; i < prices.length; i += 1) {
    assert.ok(prices[i]! < prices[i - 1]!, `${CREDIT_PACKS[i]!.id}: цена за тысячу не падает`);
  }
  assert.ok(Math.abs(1 - prices[4]! / prices[0]! - 0.2) < 0.005);
});

test('Бонус за крипту по пакетам: +15%, и пакет с бонусом всё равно прибылен', () => {
  for (const pack of CREDIT_PACKS) {
    const bonus = packCryptoBonusCredits(pack);
    assert.ok(Math.abs(bonus / pack.credits - 0.15) < 0.001, `${pack.id}: бонус ${bonus}`);
    assert.equal(bonus % 5, 0, 'бонус округлён до 5 кредитов');
    assert.ok(packProfitUsd(pack, 'crypto') > 0);
  }
});

test('Пробные кредиты: себестоимость $0.21 на пользователя; окупаемость по каналам и пакетам', () => {
  assert.ok(Math.abs(TRIAL_COST_USD - 0.211) < 0.001);
  // Криптой и картой любой пакет окупает пробные кредиты, если их покупает 12% зарегистрированных.
  for (const pack of CREDIT_PACKS) {
    for (const channel of ['crypto', 'card'] as const) {
      const conversion = trialBreakEvenConversion(pack, channel);
      assert.ok(
        conversion < 0.12,
        `${pack.id} / ${channel}: нужно ${(conversion * 100).toFixed(1)}% покупателей`,
      );
    }
  }
  // Звёзды: чем крупнее пакет (до $50), тем меньше покупателей нужно. Пакет $5 в звёздах окупает
  // пробные кредиты, только если его покупает больше четверти зарегистрированных.
  const stars = CREDIT_PACKS.filter((item) => item.priceUsd <= 50).map((pack) =>
    trialBreakEvenConversion(pack, 'stars'),
  );
  for (let i = 1; i < stars.length; i += 1) assert.ok(stars[i]! < stars[i - 1]!);
  assert.ok(stars[0]! > 0.2 && stars[0]! < 0.3, `$5: ${(stars[0]! * 100).toFixed(1)}%`);
  // Пакет $100 в звёздах почти без прибыли: пробные кредиты им не окупить — известный риск скидки 20%.
  const big = CREDIT_PACKS.find((item) => item.priceUsd === 100)!;
  assert.ok(trialBreakEvenConversion(big, 'stars') > 0.3);
});
