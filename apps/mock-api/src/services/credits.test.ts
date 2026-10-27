import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DocStore } from '../store/doc-store.js';
import { CreditStore, DAY_MS, type LegacyPremiumCredit } from '../store/credit-store.js';
import { UsageStore } from '../store/usage-store.js';
import {
  buildCreditsReport,
  CARRY_DAYS,
  CreditService,
  LOW_CREDITS_RATIO,
  PERIOD_DAYS,
  TRIAL_DAYS,
  toCredits,
  toUsd,
} from './credits.js';
import { PLAN_ENTITLEMENTS, TRIAL_CREDITS, cryptoBonusCredits } from './entitlement.js';
import { CREDIT_PACKS, CREDIT_PACK_VALID_DAYS, packCryptoBonusCredits } from './pricing.js';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const newUsageStore = () =>
  new UsageStore(join(mkdtempSync(join(tmpdir(), 'ketner-credits-')), 'usage.json'));
const newService = (legacy?: DocStore<LegacyPremiumCredit>) =>
  new CreditService(new CreditStore(), legacy);

test('Free получает пробные кредиты один раз и не получает новых, когда они кончились или истекли', () => {
  const credits = newService();
  const balance = credits.balance('u1', 'free', NOW);
  assert.equal(toCredits(balance.remainingUsd), TRIAL_CREDITS);
  assert.equal(
    balance.nextExpiresAt,
    new Date(NOW + TRIAL_DAYS * DAY_MS).toISOString(),
    'пробные кредиты живут 30 дней',
  );
  const [trial] = credits.grantsOf('u1');
  assert.equal(trial?.id, 'trial:u1');
  assert.equal(trial?.kind, 'free');

  // Потратил всё — новых кредитов нет, ни завтра, ни через месяц.
  credits.charge('u1', toUsd(TRIAL_CREDITS), NOW);
  assert.equal(credits.balance('u1', 'free', NOW + DAY_MS).remainingUsd, 0);
  assert.equal(credits.balance('u1', 'free', NOW + 29 * DAY_MS).remainingUsd, 0);
  assert.equal(credits.balance('u1', 'free', NOW + 31 * DAY_MS).remainingUsd, 0);
  assert.equal(credits.grantsOf('u1').length, 1, 'грант один на пользователя');

  // Не потратил — через 30 дней кредиты сгорают и тоже не возобновляются.
  const idle = newService();
  idle.balance('u2', 'free', NOW);
  assert.equal(idle.balance('u2', 'free', NOW + 31 * DAY_MS).remainingUsd, 0);
});

test('пробные кредиты получает и покупатель, а подписчик прежней системы — нет', () => {
  const credits = newService();
  credits.balance('buyer', 'credits', NOW);
  assert.deepEqual(
    credits.grantsOf('buyer').map((g) => g.id),
    ['trial:buyer'],
  );
  credits.balance('sub', 'plus', NOW);
  assert.deepEqual(
    credits.grantsOf('sub').map((g) => g.kind),
    ['auto'],
  );
});

test('платный тариф без платежа (VIP, выдан админом) получает грант auto и обновляет его после срока', () => {
  const credits = newService();
  const first = credits.balance('vip', 'pro', NOW);
  assert.equal(toCredits(first.remainingUsd), PLAN_ENTITLEMENTS.pro.monthlyCredits);
  assert.deepEqual(
    credits.grantsOf('vip').map((g) => g.kind),
    ['auto'],
  );
  // Повторное обращение в тот же день грант не дублирует.
  credits.balance('vip', 'pro', NOW + 1000);
  assert.equal(credits.grantsOf('vip').length, 1);

  // Грант на 30 дней истёк — выдаётся следующий.
  credits.charge('vip', 1, NOW);
  const later = credits.balance('vip', 'pro', NOW + 31 * DAY_MS);
  assert.equal(toCredits(later.remainingUsd), PLAN_ENTITLEMENTS.pro.monthlyCredits);
});

test('при живом гранте от платежа грант auto не выдаётся', () => {
  const credits = newService();
  credits.grantForPayment(
    { id: 'pay_1', userId: 'u1', method: 'card' },
    'plus',
    new Date(NOW + 30 * DAY_MS).toISOString(),
    NOW,
  );
  credits.balance('u1', 'plus', NOW);
  assert.deepEqual(
    credits.grantsOf('u1').map((g) => g.kind),
    ['plan'],
  );
});

test('оплата тарифа: кредиты живут оплаченный период и ещё один; повторная доставка не дублирует', () => {
  const credits = newService();
  const renewsAt = new Date(NOW + 30 * DAY_MS).toISOString();
  const first = credits.grantForPayment(
    { id: 'pay_1', userId: 'u1', method: 'card' },
    'pro',
    renewsAt,
    NOW,
  );
  assert.equal(first.bonus, null);
  assert.equal(toCredits(first.plan.amountUsd), PLAN_ENTITLEMENTS.pro.monthlyCredits);
  assert.equal(first.plan.expiresAt, new Date(NOW + (30 + CARRY_DAYS) * DAY_MS).toISOString());

  credits.grantForPayment({ id: 'pay_1', userId: 'u1', method: 'card' }, 'pro', renewsAt, NOW);
  assert.equal(credits.grantsOf('u1').length, 1);
  assert.equal(
    toCredits(credits.balance('u1', 'pro', NOW).remainingUsd),
    PLAN_ENTITLEMENTS.pro.monthlyCredits,
  );
});

test('оплата криптой добавляет бонусный грант на тот же срок', () => {
  const credits = newService();
  const renewsAt = new Date(NOW + 30 * DAY_MS).toISOString();
  const { plan, bonus } = credits.grantForPayment(
    { id: 'pay_c', userId: 'u1', method: 'crypto' },
    'ultra',
    renewsAt,
    NOW,
  );
  assert.ok(bonus);
  assert.equal(bonus.id, 'pay_c:bonus');
  assert.equal(bonus.kind, 'bonus');
  assert.equal(bonus.expiresAt, plan.expiresAt);
  assert.equal(toCredits(bonus.amountUsd), cryptoBonusCredits('ultra'));
  assert.equal(
    toCredits(credits.balance('u1', 'ultra', NOW).remainingUsd),
    PLAN_ENTITLEMENTS.ultra.monthlyCredits + cryptoBonusCredits('ultra'),
  );
  // Звёзды и карта бонуса не дают.
  for (const method of ['card', 'stars', 'rub']) {
    const other = credits.grantForPayment(
      { id: `pay_${method}`, userId: 'u2', method },
      'ultra',
      renewsAt,
      NOW,
    );
    assert.equal(other.bonus, null, method);
  }
});

test('платёж без даты продления даёт грант на 30 + 30 дней от сейчас', () => {
  const credits = newService();
  const { plan } = credits.grantForPayment(
    { id: 'pay_x', userId: 'u1', method: 'card' },
    'plus',
    null,
    NOW,
  );
  assert.equal(plan.expiresAt, new Date(NOW + (PERIOD_DAYS + CARRY_DAYS) * DAY_MS).toISOString());
});

test('перенос остатка: неиспользованные кредиты прошлого периода тратятся первыми и сгорают через период', () => {
  const credits = newService();
  const period = (n: number) => new Date(NOW + (n + 1) * 30 * DAY_MS).toISOString();
  credits.grantForPayment({ id: 'p1', userId: 'u1', method: 'card' }, 'plus', period(0), NOW);
  const day30 = NOW + 30 * DAY_MS;
  credits.grantForPayment({ id: 'p2', userId: 'u1', method: 'card' }, 'plus', period(1), day30);

  const monthly = PLAN_ENTITLEMENTS.plus.monthlyCredits;
  assert.equal(toCredits(credits.balance('u1', 'plus', day30).remainingUsd), monthly * 2);

  credits.charge('u1', toUsd(monthly + 500), day30);
  assert.equal(credits.store.get('p1')?.remainingUsd, 0);
  assert.equal(credits.store.get('p2')?.remainingUsd, toUsd(monthly - 500));

  // Если не тратить: остаток первого периода сгорает в день 60.
  const idle = newService();
  idle.grantForPayment({ id: 'p1', userId: 'u1', method: 'card' }, 'plus', period(0), NOW);
  assert.equal(toCredits(idle.balance('u1', 'plus', NOW + 59 * DAY_MS).remainingUsd), monthly);
});

test('остатки пакетов старой системы переходят в кредиты один раз и с прежним сроком', () => {
  const legacy = new DocStore<LegacyPremiumCredit>('legacy_credits');
  const expires = new Date(NOW + 10 * DAY_MS).toISOString();
  legacy.put({
    id: 'lc1',
    userId: 'u1',
    packId: 'pack-5',
    amountUsd: 5,
    remainingUsd: 2.5,
    purchasedAt: new Date(NOW - 20 * DAY_MS).toISOString(),
    expiresAt: expires,
    status: 'active',
  });
  legacy.put({
    id: 'lc_old',
    userId: 'u1',
    packId: 'pack-5',
    amountUsd: 5,
    remainingUsd: 5,
    purchasedAt: new Date(NOW - 60 * DAY_MS).toISOString(),
    expiresAt: new Date(NOW - 1000).toISOString(),
    status: 'active',
  });
  legacy.put({
    id: 'lc_refunded',
    userId: 'u1',
    packId: 'pack-5',
    amountUsd: 5,
    remainingUsd: 5,
    purchasedAt: new Date(NOW).toISOString(),
    expiresAt: expires,
    status: 'refunded',
  });
  const credits = newService(legacy);
  const balance = credits.balance('u1', 'plus', NOW);
  // 300 Plus-кредитов — грант auto; 2.5 доллара = 2 500 кредитов из пакета.
  assert.equal(toCredits(balance.remainingUsd), PLAN_ENTITLEMENTS.plus.monthlyCredits + 2500);
  assert.equal(balance.nextExpiresAt, expires, 'пакет сгорает раньше');
  assert.equal(credits.grantsOf('u1').filter((g) => g.kind === 'pack').length, 1);

  // Повторные обращения (и новый экземпляр сервиса) грант не дублируют.
  credits.balance('u1', 'plus', NOW + 1000);
  const again = new CreditService(credits.store, legacy);
  again.balance('u1', 'plus', NOW + 2000);
  assert.equal(credits.grantsOf('u1').filter((g) => g.kind === 'pack').length, 1);
});

test('пакет: кредиты на год, повторная доставка платежа не дублирует', () => {
  const credits = newService();
  const pack = CREDIT_PACKS[0]!;
  const first = credits.grantForPack({ id: 'stars:1', userId: 'u1', method: 'stars' }, pack, NOW);
  assert.equal(first.bonus, null, 'звёзды бонуса не дают');
  assert.equal(first.pack.kind, 'pack');
  assert.equal(toCredits(first.pack.amountUsd), pack.credits);
  assert.equal(first.pack.expiresAt, new Date(NOW + CREDIT_PACK_VALID_DAYS * DAY_MS).toISOString());
  credits.grantForPack({ id: 'stars:1', userId: 'u1', method: 'stars' }, pack, NOW + 1000);
  assert.equal(credits.grantsOf('u1').length, 1);
});

test('пакет, оплаченный криптой, получает бонус +15% отдельным грантом на тот же срок', () => {
  const credits = newService();
  for (const pack of CREDIT_PACKS) {
    const { pack: main, bonus } = credits.grantForPack(
      { id: `crypto:${pack.id}`, userId: 'u1', method: 'crypto' },
      pack,
      NOW,
    );
    assert.ok(bonus, pack.id);
    assert.equal(bonus.id, `crypto:${pack.id}:bonus`);
    assert.equal(bonus.kind, 'bonus');
    assert.equal(bonus.paymentId, main.paymentId, 'возврат отзывает оба гранта');
    assert.equal(bonus.expiresAt, main.expiresAt);
    assert.equal(toCredits(bonus.amountUsd), packCryptoBonusCredits(pack));
    const share = packCryptoBonusCredits(pack) / pack.credits;
    assert.ok(share > 0.149 && share < 0.151, `${pack.id}: бонус ${share}`);
  }
});

test('купленные кредиты открывают полный доступ, пока они есть; пробные и истёкшие — нет', () => {
  const credits = newService();
  const pack = CREDIT_PACKS[0]!;
  credits.balance('u1', 'free', NOW);
  assert.equal(credits.hasPurchased('u1', NOW), false, 'пробные кредиты доступа не открывают');

  credits.grantForPack({ id: 'stars:1', userId: 'u1', method: 'stars' }, pack, NOW);
  assert.equal(credits.hasPurchased('u1', NOW), true);
  assert.equal(credits.hasPurchased('someone', NOW), false);

  // Пробные тратятся первыми (сгорают раньше), покупные остаются.
  credits.charge('u1', toUsd(TRIAL_CREDITS + 100), NOW);
  assert.equal(credits.hasPurchased('u1', NOW), true);
  assert.equal(toCredits(credits.balance('u1', 'credits', NOW).remainingUsd), pack.credits - 100);

  // Потратил всё — доступ возвращается к Free-уровню.
  credits.charge('u1', toUsd(pack.credits), NOW);
  assert.equal(credits.hasPurchased('u1', NOW), false);

  // Через год кредиты сгорают.
  credits.grantForPack({ id: 'stars:2', userId: 'u2', method: 'stars' }, pack, NOW);
  assert.equal(credits.hasPurchased('u2', NOW + 364 * DAY_MS), true);
  assert.equal(credits.hasPurchased('u2', NOW + 366 * DAY_MS), false);

  // Возврат отзывает кредиты и доступ.
  credits.store.revokeByPayment('stars:2');
  assert.equal(credits.hasPurchased('u2', NOW), false);
});

test('ручная выдача: кредиты с заданным сроком', () => {
  const credits = newService();
  const grant = credits.grantManually(
    { userId: 'u1', credits: 1500, days: 7, note: 'компенсация' },
    NOW,
  );
  assert.equal(grant.kind, 'admin');
  assert.equal(toCredits(grant.amountUsd), 1500);
  assert.equal(grant.expiresAt, new Date(NOW + 7 * DAY_MS).toISOString());
  assert.equal(grant.note, 'компенсация');
});

test('отчёт: остаток в кредитах, ступень, цены моделей и бесплатная модель', () => {
  const credits = newService();
  const usageStore = newUsageStore();
  const pack = CREDIT_PACKS[1]!;
  credits.grantForPack({ id: 'stars:1', userId: 'u1', method: 'stars' }, pack, NOW);
  const full = buildCreditsReport('u1', 'credits', { credits, usageStore }, undefined, NOW);
  assert.equal(full.plan, 'credits');
  // Пробные кредиты выдаются при первом обращении к балансу вместе с пакетом.
  assert.equal(full.balance, pack.credits + TRIAL_CREDITS);
  assert.equal(full.granted, pack.credits + TRIAL_CREDITS);
  assert.equal(full.trialCredits, TRIAL_CREDITS);
  assert.equal(full.purchased, true);
  assert.equal(full.stage, 'normal');
  assert.equal(full.low, false);
  assert.deepEqual(full.grants.map((g) => g.kind).sort(), ['free', 'pack']);
  assert.deepEqual(full.freeModel && Object.keys(full.freeModel).sort(), ['id', 'name']);

  const mini = full.models.find((m) => m.id === 'ketner-mini');
  const opus = full.models.find((m) => m.id === 'claude-opus-5.5');
  const free = full.models.find((m) => m.free);
  assert.ok(mini && opus && free);
  assert.ok(mini.requestCredits < opus.requestCredits, 'Mini дешевле Opus');
  assert.ok((mini.remaining ?? 0) > (opus.remaining ?? 0));
  assert.equal(free.requestCredits, 0);
  assert.equal(free.remaining, null);
  assert.equal(free.affordable, true);
  assert.equal(
    full.models.find((m) => m.id === 'auto'),
    undefined,
  );

  // Кредиты на исходе.
  const granted = pack.credits + TRIAL_CREDITS;
  credits.charge('u1', toUsd(granted - Math.floor(granted * LOW_CREDITS_RATIO) + 100), NOW);
  const low = buildCreditsReport('u1', 'credits', { credits, usageStore }, undefined, NOW);
  assert.equal(low.stage, 'normal');
  assert.equal(low.low, true);

  // Кредиты кончились: отвечает бесплатная модель, платные не по карману, доступ вернулся к Free.
  credits.charge('u1', 100_000, NOW);
  const empty = buildCreditsReport('u1', 'free', { credits, usageStore }, undefined, NOW);
  assert.equal(empty.balance, 0);
  assert.equal(empty.stage, 'exhausted');
  assert.equal(empty.low, false);
  assert.equal(empty.purchased, false);
  assert.equal(empty.grants.length, 0);
  assert.ok(empty.models.filter((m) => !m.free).every((m) => !m.affordable && m.remaining === 0));
  assert.ok(empty.models.filter((m) => m.free).every((m) => m.affordable));
});

test('отчёт: режим Max дороже стандартного и открыт всем; у Free все платные модели в списке', () => {
  const credits = newService();
  const usageStore = newUsageStore();
  const standard = buildCreditsReport('u1', 'ultra', { credits, usageStore }, 'standard', NOW);
  const max = buildCreditsReport('u1', 'ultra', { credits, usageStore }, 'max', NOW);
  assert.equal(max.reasoningMode, 'max');
  const price = (report: typeof standard) =>
    report.models.find((m) => m.id === 'claude-opus-5.5')?.requestCredits ?? 0;
  assert.ok(price(max) > price(standard));

  // Free: пробные 200 кредитов, все модели доступны, Max тоже.
  const freeMax = buildCreditsReport('f1', 'free', { credits, usageStore }, 'max', NOW);
  assert.equal(freeMax.reasoningMode, 'max');
  assert.equal(freeMax.balance, TRIAL_CREDITS);
  assert.equal(freeMax.purchased, false);
  const opus = freeMax.models.find((m) => m.id === 'claude-opus-5.5');
  assert.ok(opus, 'Opus в списке');
});

test('пробных кредитов хватает на один запрос GPT-6 Astra, но не на два', () => {
  const credits = newService();
  const usageStore = newUsageStore();
  const report = buildCreditsReport('f1', 'free', { credits, usageStore }, undefined, NOW);
  const astra = report.models.find((m) => m.id === 'gpt-6-astra');
  assert.ok(astra, 'GPT-6 Astra в списке Free');
  assert.equal(astra.affordable, true, 'один запрос по карману');
  assert.ok(
    (astra.remaining ?? 0) >= 1 && (astra.remaining ?? 0) <= 2,
    `ровно один-два запроса: ${astra.remaining}`,
  );
});
