import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveChatIdentity } from './chat-identity.js';
import { MODELS, resolveModel } from '../ai/models.js';
import { modelRegistry } from '../ai/model-registry.js';
import { EntitlementService } from './entitlement.js';

const base = { anonymousUserId: 'demo-user', anonymousPlan: 'free' as const };
const NOW = Date.parse('2026-10-06T12:00:00Z');

test('production: запрос без сессии отклоняется 401', () => {
  const r = resolveChatIdentity({ ...base, allowAnonymous: false });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 401);
    assert.equal(r.code, 'unauthorized');
  }
});

test('вне production анонимный запрос — общий demo-user на бесплатном плане', () => {
  const r = resolveChatIdentity({ ...base, allowAnonymous: true });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.userId, 'demo-user');
    assert.equal(r.plan, 'free');
    assert.equal(r.anonymous, true);
    assert.equal(r.isVip, false);
  }
});

test('тариф берётся из профиля, а не из чего-либо присланного клиентом', () => {
  const r = resolveChatIdentity({
    ...base,
    allowAnonymous: false,
    sessionUser: { id: 'u1', email: 'u1@example.com', plan: 'free' },
    storedUser: { plan: 'free' },
    now: NOW,
  });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.plan, 'free');
    assert.equal(r.userId, 'u1');
  }
});

test('купленные кредиты: уровень credits берётся из сессии, но только без платной подписки', () => {
  const buyer = resolveChatIdentity({
    ...base,
    allowAnonymous: false,
    sessionUser: { id: 'u3', email: 'u3@example.com', plan: 'credits' },
    storedUser: { plan: 'free' },
    now: NOW,
  });
  assert.ok(buyer.ok);
  if (buyer.ok) assert.equal(buyer.plan, 'credits');

  // Профиль в базе хранит free: клиент не может повысить уровень сам, а сессию собирает сервер.
  const plain = resolveChatIdentity({
    ...base,
    allowAnonymous: false,
    sessionUser: { id: 'u4', email: 'u4@example.com', plan: 'free' },
    storedUser: { plan: 'free' },
    now: NOW,
  });
  assert.ok(plain.ok);
  if (plain.ok) assert.equal(plain.plan, 'free');

  // Подписчик прежней системы остаётся на своём тарифе, даже если в сессии указано credits.
  const subscriber = resolveChatIdentity({
    ...base,
    allowAnonymous: false,
    sessionUser: { id: 'u5', email: 'u5@example.com', plan: 'credits' },
    storedUser: { plan: 'plus' },
    subscription: {
      plan: 'plus',
      status: 'active',
      renewsAt: new Date(NOW + 86_400_000).toISOString(),
    },
    now: NOW,
  });
  assert.ok(subscriber.ok);
  if (subscriber.ok) assert.equal(subscriber.plan, 'plus');
});

test('оплаченный тариф действует, пока идёт период', () => {
  const r = resolveChatIdentity({
    ...base,
    allowAnonymous: false,
    sessionUser: { id: 'u2', email: 'u2@example.com', plan: 'pro' },
    storedUser: { plan: 'pro' },
    subscription: {
      plan: 'pro',
      status: 'active',
      renewsAt: new Date(NOW + 86_400_000).toISOString(),
    },
    now: NOW,
  });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.plan, 'pro');
});

test('истёкшая подписка сводит тариф к free', () => {
  const r = resolveChatIdentity({
    ...base,
    allowAnonymous: false,
    sessionUser: { id: 'u3', email: 'u3@example.com', plan: 'ultra' },
    storedUser: { plan: 'ultra' },
    subscription: {
      plan: 'ultra',
      status: 'active',
      renewsAt: new Date(NOW - 3 * 86_400_000).toISOString(),
    },
    now: NOW,
  });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.plan, 'free');
});

test('VIP по флагу получает ultra', () => {
  const r = resolveChatIdentity({
    ...base,
    allowAnonymous: false,
    sessionUser: { id: 'u4', email: 'u4@example.com', plan: 'free', isVip: true },
    now: NOW,
  });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.plan, 'ultra');
    assert.equal(r.isVip, true);
  }
});

test('каталог для /api/meta согласован с реестром: доступ по тарифу — один источник правды', () => {
  assert.ok(MODELS.length >= 5);
  for (const info of MODELS) {
    const entry = modelRegistry.get(info.id);
    if (!entry) throw new Error(`модель ${info.id} должна быть в реестре`);
    assert.equal(Boolean(info.isPro), entry.isPro, `isPro для ${info.id}`);
    assert.equal(info.requiredPlan, entry.requiredPlan ?? undefined, `requiredPlan для ${info.id}`);
  }
});

test('все модели открыты на любом уровне доступа: Free, купленные кредиты и прежние подписчики', () => {
  const check = (id: string, plan: 'free' | 'credits' | 'plus' | 'pro' | 'ultra'): boolean =>
    EntitlementService.checkModelAccess(modelRegistry.resolve(id), plan).allowed;
  for (const plan of ['free', 'credits', 'plus', 'pro', 'ultra'] as const) {
    for (const id of [
      'ketner-mini',
      'claude-haiku-5.5',
      'deepseek-v4.1-flash',
      'ketner-pro',
      'gpt-6.1-sol',
      'claude-opus-5.5',
      'grok-4.7',
      'gpt-6-astra',
      'gemini-3.8-flash',
    ]) {
      assert.equal(check(id, plan), true, `${id} на ${plan}`);
    }
  }
  // Старые id ведут на актуальные модели, и правила доступа их тоже не закрывают
  assert.equal(check('claude-fable', 'free'), true);
});

test('resolveModel для публичных id возвращает ту же модель, старые id — актуальную, неизвестный id — auto', () => {
  assert.equal(resolveModel('gpt-6.1-sol').id, 'gpt-6.1-sol');
  assert.equal(resolveModel('gpt-6-astra').id, 'gpt-6-astra');
  assert.equal(resolveModel('claude-fable').id, 'claude-opus-5.5');
  assert.equal(resolveModel('claude-fable-5.1').id, 'claude-opus-5.5');
  assert.equal(resolveModel('gpt-4o').id, 'gpt-6.1-sol');
  assert.equal(resolveModel('нет-такой-модели').id, 'auto');
});
