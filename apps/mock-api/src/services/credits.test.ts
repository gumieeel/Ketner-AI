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
  toCredits,
  toUsd,
} from './credits.js';
import { PLAN_ENTITLEMENTS, cryptoBonusCredits, planCreditsUsd } from './entitlement.js';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const newUsageStore = () =>
  new UsageStore(join(mkdtempSync(join(tmpdir(), 'ketner-credits-')), 'usage.json'));
const newService = (legacy?: DocStore<LegacyPremiumCredit>) =>
  new CreditService(new CreditStore(), legacy);

test('Free получает месячный грант сам и не получает второй, пока первый не истёк', () => {
  const credits = newService();
  const balance = credits.balance('u1', 'free', NOW);
  assert.equal(toCredits(balance.remainingUsd), PLAN_ENTITLEMENTS.free.monthlyCredits);
  assert.equal(
    balance.nextExpiresAt,
    new Date(NOW + PERIOD_DAYS * DAY_MS).toISOString(),
    'грант живёт 30 дней',
  );

  // Потратил всё — до конца периода новых кредитов нет.
  credits.charge('u1', planCreditsUsd('free'), NOW);
  assert.equal(credits.balance('u1', 'free', NOW + DAY_MS).remainingUsd, 0);
  assert.equal(credits.balance('u1', 'free', NOW + 29 * DAY_MS).remainingUsd, 0);
  // Через 30 дней — новый грант.
  const next = credits.balance('u1', 'free', NOW + 30 * DAY_MS + 1000);
  assert.equal(toCredits(next.remainingUsd), PLAN_ENTITLEMENTS.free.monthlyCredits);
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
  const full = buildCreditsReport('u1', 'pro', { credits, usageStore }, undefined, NOW);
  assert.equal(full.plan, 'pro');
  assert.equal(full.balance, PLAN_ENTITLEMENTS.pro.monthlyCredits);
  assert.equal(full.monthly, PLAN_ENTITLEMENTS.pro.monthlyCredits);
  assert.equal(full.stage, 'normal');
  assert.equal(full.low, false);
  assert.equal(full.grants.length, 1);
  assert.equal(full.grants[0]?.kind, 'auto');
  assert.equal(full.refreshAt, new Date(NOW + PERIOD_DAYS * DAY_MS).toISOString());
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
  const monthly = PLAN_ENTITLEMENTS.pro.monthlyCredits;
  credits.charge('u1', toUsd(monthly - Math.floor(monthly * LOW_CREDITS_RATIO) + 100), NOW);
  const low = buildCreditsReport('u1', 'pro', { credits, usageStore }, undefined, NOW);
  assert.equal(low.stage, 'normal');
  assert.equal(low.low, true);

  // Кредиты кончились: отвечает бесплатная модель, платные не по карману.
  credits.charge('u1', 1000, NOW);
  const empty = buildCreditsReport('u1', 'pro', { credits, usageStore }, undefined, NOW);
  assert.equal(empty.balance, 0);
  assert.equal(empty.stage, 'exhausted');
  assert.equal(empty.low, false);
  assert.equal(empty.grants.length, 0);
  assert.ok(empty.models.filter((m) => !m.free).every((m) => !m.affordable && m.remaining === 0));
  assert.ok(empty.models.filter((m) => m.free).every((m) => m.affordable));
});

test('отчёт: режим Max дороже стандартного, Free не видит платные модели старших тарифов', () => {
  const credits = newService();
  const usageStore = newUsageStore();
  const standard = buildCreditsReport('u1', 'ultra', { credits, usageStore }, 'standard', NOW);
  const max = buildCreditsReport('u1', 'ultra', { credits, usageStore }, 'max', NOW);
  assert.equal(max.reasoningMode, 'max');
  const price = (report: typeof standard) =>
    report.models.find((m) => m.id === 'claude-opus-5.5')?.requestCredits ?? 0;
  assert.ok(price(max) > price(standard));

  const freePlan = buildCreditsReport('f1', 'free', { credits, usageStore }, undefined, NOW);
  assert.equal(
    freePlan.models.find((m) => m.id === 'claude-opus-5.5'),
    undefined,
  );
});

test('отчёт: когда придут новые кредиты — конец периода, а не срок переноса остатка', () => {
  const credits = newService();
  const usageStore = newUsageStore();
  const renewsAt = new Date(NOW + 12 * DAY_MS).toISOString();
  credits.grantForPayment({ id: 'pay_1', userId: 'u1', method: 'card' }, 'plus', renewsAt, NOW);
  const report = buildCreditsReport('u1', 'plus', { credits, usageStore }, undefined, NOW);
  assert.equal(report.refreshAt, renewsAt);
  assert.equal(report.nextExpiresAt, new Date(NOW + (12 + CARRY_DAYS) * DAY_MS).toISOString());

  // Кредиты потрачены, а дата продления известна.
  credits.charge('u1', 1000, NOW);
  const spent = buildCreditsReport('u1', 'plus', { credits, usageStore }, undefined, NOW);
  assert.equal(spent.stage, 'exhausted');
  assert.equal(spent.refreshAt, renewsAt);
});
