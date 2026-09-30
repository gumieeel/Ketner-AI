import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readJson, startTestServer } from '../testing/server.js';
import type { SbpInvoice, Subscription, TelegramStarsInvoice, User } from '../types.js';

test('telegram: статус бота GET /api/telegram/status', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/telegram/status`);
  assert.equal(response.status, 200);

  const data = await readJson<{ configured: boolean; botUsername: string; botUrl: string }>(
    response,
  );
  assert.equal(typeof data.configured, 'boolean');
  assert.ok(data.botUsername.length > 0);
  assert.ok(data.botUrl.includes('t.me/'));
});

test('telegram: обработка /start pay_<planId>_<userId> через webhook', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const update = {
    update_id: 1001,
    message: {
      message_id: 1,
      chat: { id: 987654321, type: 'private' },
      date: Math.floor(Date.now() / 1000),
      text: '/start pay_gpt-pro_user_42',
    },
  };

  const response = await fetch(`${server.baseUrl}/api/telegram/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  assert.equal(response.status, 200);

  const body = await readJson<{ ok: boolean; result: { handled: boolean; action: string } }>(
    response,
  );
  assert.equal(body.ok, true);
  assert.equal(body.result.handled, true);
  assert.equal(body.result.action, 'pay_deep_link_handled');
});

test('telegram: callback_query для СБП генерирует инвойс', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const update = {
    update_id: 1002,
    callback_query: {
      id: 'cb_123',
      from: { id: 111, first_name: 'Alex' },
      message: {
        message_id: 2,
        chat: { id: 987654321 },
      },
      data: 'pay_sbp:ultra:user_42',
    },
  };

  const response = await fetch(`${server.baseUrl}/api/telegram/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  assert.equal(response.status, 200);

  const body = await readJson<{ ok: boolean; result: { handled: boolean; action: string } }>(
    response,
  );
  assert.equal(body.ok, true);
  assert.equal(body.result.action, 'sbp_link_sent');
});

test('telegram: successful_payment активирует подписку', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const targetUserId = 'tg-paid-user';

  const update = {
    update_id: 1003,
    message: {
      message_id: 3,
      chat: { id: 987654321, type: 'private' },
      date: Math.floor(Date.now() / 1000),
      successful_payment: {
        currency: 'XTR',
        total_amount: 1350,
        invoice_payload: JSON.stringify({ planId: 'ultra', userId: targetUserId }),
        telegram_payment_charge_id: 'ch_test_123',
      },
    },
  };

  const response = await fetch(`${server.baseUrl}/api/telegram/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  assert.equal(response.status, 200);

  const body = await readJson<{ ok: boolean; result: { handled: boolean; action: string } }>(
    response,
  );
  assert.equal(body.result.action, 'stars_payment_completed');

  // Проверяем, что подписка пользователя обновилась на ultra
  const subRes = await fetch(`${server.baseUrl}/api/billing/subscription`, {
    headers: { 'x-user-id': targetUserId },
  });
  const subData = await readJson<{ subscription: Subscription }>(subRes);
  assert.equal(subData.subscription.plan, 'ultra');
  assert.equal(subData.subscription.status, 'active');
});

test('billing: оплата по СБП (создание, статус и подтверждение)', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  // 1. Создание инвойса СБП
  const createRes = await fetch(`${server.baseUrl}/api/billing/sbp/create-invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId: 'gpt-pro' }),
  });
  assert.equal(createRes.status, 200);
  const { invoice } = await readJson<{ invoice: SbpInvoice }>(createRes);

  assert.ok(invoice.id.startsWith('sbp_'));
  assert.equal(invoice.planId, 'gpt-pro');
  assert.equal(invoice.amount, 1199);
  assert.equal(invoice.status, 'pending');
  assert.ok(invoice.qrPayload.startsWith('https://qr.nspk.ru/'));
  assert.ok(invoice.deepLink.startsWith('https://qr.nspk.ru/'));

  // 2. Проверка статуса
  const statusRes = await fetch(`${server.baseUrl}/api/billing/sbp/status/${invoice.id}`);
  assert.equal(statusRes.status, 200);
  const statusData = await readJson<{ status: string; invoice: SbpInvoice }>(statusRes);
  assert.equal(statusData.status, 'pending');

  // 3. Подтверждение оплаты СБП
  const confirmRes = await fetch(`${server.baseUrl}/api/billing/sbp/confirm/${invoice.id}`, {
    method: 'POST',
  });
  assert.equal(confirmRes.status, 200);
  const confirmData = await readJson<{
    success: boolean;
    subscription: Subscription;
    user: User;
  }>(confirmRes);
  assert.equal(confirmData.success, true);
  assert.equal(confirmData.subscription.plan, 'gpt-pro');
  assert.equal(confirmData.subscription.status, 'active');
  assert.equal(confirmData.user.plan, 'gpt-pro');
});

test('billing: Telegram Stars (создание счёта в ⭐️ XTR и подтверждение)', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  // 1. Создание счёта Stars для тарифа Ultra
  const createRes = await fetch(`${server.baseUrl}/api/billing/telegram-stars/create-invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId: 'ultra' }),
  });
  assert.equal(createRes.status, 200);
  const { invoice } = await readJson<{ invoice: TelegramStarsInvoice }>(createRes);

  assert.ok(invoice.id.startsWith('stars_'));
  assert.equal(invoice.planId, 'ultra');
  assert.equal(invoice.priceRub, 2990);
  assert.equal(invoice.starsAmount, 1600); // 1600 ⭐️ для 2990 ₽
  assert.ok(invoice.botDeepLink.includes('t.me/'));
  assert.ok(invoice.botDeepLink.includes('pay_ultra'));

  // 2. Статус
  const statusRes = await fetch(
    `${server.baseUrl}/api/billing/telegram-stars/status/${invoice.id}`,
  );
  assert.equal(statusRes.status, 200);
  const statusData = await readJson<{ status: string; invoice: TelegramStarsInvoice }>(statusRes);
  assert.equal(statusData.status, 'pending');

  // 3. Подтверждение
  const confirmRes = await fetch(
    `${server.baseUrl}/api/billing/telegram-stars/confirm/${invoice.id}`,
    {
      method: 'POST',
    },
  );
  assert.equal(confirmRes.status, 200);
  const confirmData = await readJson<{
    success: boolean;
    subscription: Subscription;
    user: User;
  }>(confirmRes);
  assert.equal(confirmData.success, true);
  assert.equal(confirmData.subscription.plan, 'ultra');
});

test('telegram: симуляция оплаты POST /api/telegram/simulate-payment', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/telegram/simulate-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId: 'claude-pro', userId: 'sim-user' }),
  });
  assert.equal(response.status, 200);

  const data = await readJson<{ ok: boolean; subscription: Subscription }>(response);
  assert.equal(data.ok, true);
  assert.equal(data.subscription.plan, 'claude-pro');
  assert.equal(data.subscription.status, 'active');
});
