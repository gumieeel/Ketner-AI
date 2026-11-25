import assert from 'node:assert/strict';
import test from 'node:test';
import { checkServiceConnect, nextTierWithMoreServices } from './external-services.js';
import { tierById } from '../services/tiers.js';

test('внешний сервис: без тарифа — нельзя; переподключение того же — без места, но с тарифом', () => {
  const none = checkServiceConnect({ tier: null, used: 0, alreadyConnected: false });
  assert.equal(none.ok, false);
  assert.equal(!none.ok && none.code, 'tier_required');
  assert.equal(checkServiceConnect({ tier: null, used: 1, alreadyConnected: true }).ok, false);
  assert.equal(checkServiceConnect({ tier: 'start', used: 1, alreadyConnected: true }).ok, true);
});

test('место в тарифе: Start — 1 сервис, второй — нужен Growth; Scale — наибольший', () => {
  assert.equal(checkServiceConnect({ tier: 'start', used: 0, alreadyConnected: false }).ok, true);
  const full = checkServiceConnect({ tier: 'start', used: 1, alreadyConnected: false });
  assert.deepEqual(full, {
    ok: false,
    code: 'service_limit',
    message:
      'Внешних сервисов: 1 из 1 — тариф Start. Чтобы подключить ещё один, нужен тариф Growth (до 2) — или отключите один из подключённых.',
    used: 1,
    limit: 1,
    tier: 'start',
    nextTier: 'growth',
  });
  // Тариф понизили: подключено больше, чем место, — новое подключение нельзя, старые не трогаем.
  const over = checkServiceConnect({ tier: 'growth', used: 3, alreadyConnected: false });
  assert.equal(!over.ok && over.code === 'service_limit' && over.nextTier, 'business');
  const top = checkServiceConnect({ tier: 'scale', used: 15, alreadyConnected: false });
  assert.match(!top.ok ? top.message : '', /наибольший тариф/);
  assert.equal(nextTierWithMoreServices(tierById('scale')), null);
});
