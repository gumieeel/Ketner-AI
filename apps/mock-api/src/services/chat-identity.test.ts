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

test('оплаченный тариф действует, пока идёт период', () => {
  const r = resolveChatIdentity({
    ...base,
    allowAnonymous: false,
    sessionUser: { id: 'u2', email: 'u2@example.com', plan: 'pro' },
    storedUser: { plan: 'pro' },
    subscription: { plan: 'pro', status: 'active', renewsAt: new Date(NOW + 86_400_000).toISOString() },
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

test('free не получает платные движки, plus получает стандартные, pro — флагманы', () => {
  const check = (id: string, plan: 'free' | 'plus' | 'pro' | 'ultra'): boolean =>
    EntitlementService.checkModelAccess(modelRegistry.resolve(id), plan).allowed;
  assert.equal(check('claude-3-haiku', 'free'), false);
  assert.equal(check('deepseek-v4.1-flash', 'free'), false);
  assert.equal(check('claude-3-haiku', 'plus'), true);
  assert.equal(check('gpt-6-astra', 'plus'), false);
  assert.equal(check('gpt-6-astra', 'pro'), true);
  assert.equal(check('ketner-mini', 'free'), true);
});

test('resolveModel для публичных id возвращает ту же модель, неизвестный id — auto', () => {
  assert.equal(resolveModel('gpt-4o').id, 'gpt-4o');
  assert.equal(resolveModel('нет-такой-модели').id, 'auto');
});
