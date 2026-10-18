import { signupAndVerify } from '../testing/signup.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { config } from '../config.js';
import { readJson, startTestServer } from '../testing/server.js';
import type { AuthSession, SbpInvoice, Subscription, User } from '../types.js';

/** Регистрирует администратора сайта (адрес из ADMIN_EMAILS) и возвращает заголовок авторизации. */
async function signupAdmin(baseUrl: string): Promise<{ Authorization: string }> {
  const email = 'tg-admin@example.com';
  const admins = config.adminEmails as unknown as string[];
  if (!admins.includes(email)) admins.push(email);
  const res = await signupAndVerify(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', name: 'TG Admin' }),
  });
  const body = await readJson<AuthSession>(res);
  return { Authorization: `Bearer ${body.token}` };
}

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

test('billing: оплата по СБП (создание, статус и подтверждение)', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const reg = await signupAndVerify(server.baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'sbp-user@example.com', password: 'password123', name: 'Pay' }),
  });
  const { token } = await readJson<AuthSession>(reg);
  const auth = { Authorization: `Bearer ${token}` };

  // 1. Создание инвойса СБП
  const createRes = await fetch(`${server.baseUrl}/api/billing/sbp/create-invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
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
  const statusRes = await fetch(`${server.baseUrl}/api/billing/sbp/status/${invoice.id}`, {
    headers: auth,
  });
  assert.equal(statusRes.status, 200);
  const statusData = await readJson<{ status: string; invoice: SbpInvoice }>(statusRes);
  assert.equal(statusData.status, 'pending');

  // 3. Подтверждение оплаты СБП
  const confirmRes = await fetch(`${server.baseUrl}/api/billing/sbp/confirm/${invoice.id}`, {
    method: 'POST',
    headers: auth,
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

test('telegram support bot: создание тикета, отправка админу gumieeel и ответ пользователю', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  // 1. Статус Support бота
  const statusRes = await fetch(`${server.baseUrl}/api/telegram/support/status`);
  assert.equal(statusRes.status, 200);
  const statusData = await readJson<{ botUsername: string; configured: boolean }>(statusRes);
  assert.equal(statusData.botUsername, 'ketner_support_bot');

  // 2. Администратор @gumieeel активирует своего бота (/start)
  const adminChatId = 777888999;
  const adminStartUpdate = {
    update_id: 2001,
    message: {
      message_id: 10,
      chat: { id: adminChatId, type: 'private' },
      from: { id: adminChatId, is_bot: false, first_name: 'Artem', username: 'gumieeel' },
      date: Math.floor(Date.now() / 1000),
      text: '/start',
    },
  };
  const adminRes = await fetch(`${server.baseUrl}/api/telegram/support/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': config.telegramSupportWebhookSecret,
    },
    body: JSON.stringify(adminStartUpdate),
  });
  assert.equal(adminRes.status, 200);
  const adminBody = await readJson<{ ok: boolean; result: { handled: boolean; action: string } }>(
    adminRes,
  );
  assert.equal(adminBody.result.action, 'admin_welcome_sent');

  // 3. Обычный пользователь отправляет жалобу в бот
  const userChatId = 12345678;
  const userMsgUpdate = {
    update_id: 2002,
    message: {
      message_id: 50,
      chat: { id: userChatId, type: 'private' },
      from: { id: userChatId, is_bot: false, first_name: 'Ivan', username: 'ivan_client' },
      date: Math.floor(Date.now() / 1000),
      text: 'Не могу переключить модель на GPT-4o, помогите пожалуйста!',
    },
  };
  const userRes = await fetch(`${server.baseUrl}/api/telegram/support/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': config.telegramSupportWebhookSecret,
    },
    body: JSON.stringify(userMsgUpdate),
  });
  assert.equal(userRes.status, 200);
  const userBody = await readJson<{ ok: boolean; result: { handled: boolean; action: string } }>(
    userRes,
  );
  assert.equal(userBody.result.action, 'user_ticket_message_processed');

  // 4. Проверяем список тикетов (доступен только администратору сайта)
  const adminAuth = await signupAdmin(server.baseUrl);
  const ticketsRes = await fetch(`${server.baseUrl}/api/telegram/support/tickets`, {
    headers: adminAuth,
  });
  assert.equal(ticketsRes.status, 200);
  const ticketsData = await readJson<{
    openTickets: Array<{ id: string; userChatId: number; messages: Array<{ text: string }> }>;
  }>(ticketsRes);
  assert.equal(ticketsData.openTickets.length, 1);
  const ticket = ticketsData.openTickets[0];
  assert.equal(ticket.userChatId, userChatId);
  assert.ok(ticket.messages[0].text.includes('Не могу переключить модель'));

  // 5. Администратор gumieeel отвечает на тикет через /reply <ticketId> <ответ>
  const adminReplyUpdate = {
    update_id: 2003,
    message: {
      message_id: 11,
      chat: { id: adminChatId, type: 'private' },
      from: { id: adminChatId, is_bot: false, first_name: 'Artem', username: 'gumieeel' },
      date: Math.floor(Date.now() / 1000),
      text: `/reply ${ticket.id} Здравствуйте! Проблема решена, доступ к модели открыт.`,
    },
  };
  const replyRes = await fetch(`${server.baseUrl}/api/telegram/support/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': config.telegramSupportWebhookSecret,
    },
    body: JSON.stringify(adminReplyUpdate),
  });
  assert.equal(replyRes.status, 200);
  const replyBody = await readJson<{ ok: boolean; result: { handled: boolean; action: string } }>(
    replyRes,
  );
  assert.equal(replyBody.result.action, 'admin_reply_delivered');

  // 6. Проверяем, что в истории тикета появился ответ администратора
  const updatedTicketsRes = await fetch(`${server.baseUrl}/api/telegram/support/tickets`, {
    headers: adminAuth,
  });
  const updatedTickets = await readJson<{
    openTickets: Array<{ id: string; messages: Array<{ from: string; text: string }> }>;
  }>(updatedTicketsRes);
  const updatedTicket = updatedTickets.openTickets[0];
  assert.equal(updatedTicket.messages.length, 2);
  assert.equal(updatedTicket.messages[1].from, 'admin');
  assert.ok(updatedTicket.messages[1].text.includes('Проблема решена'));
});

test('telegram (C6): вебхуки принимают только запросы с secret_token', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const update = {
    update_id: 1,
    message: { message_id: 1, chat: { id: 5, type: 'private' }, date: 1, text: '/start' },
  };
  for (const path of ['/api/telegram/webhook', '/api/telegram/support/webhook']) {
    for (const headers of [
      { 'Content-Type': 'application/json' },
      { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wrong' },
      // секрет платёжного бота не подходит поддержке и наоборот
      {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': path.includes('support')
          ? config.telegramWebhookSecret
          : config.telegramSupportWebhookSecret,
      },
    ]) {
      const res = await fetch(`${server.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(update),
      });
      assert.equal(res.status, 401, `${path} должен отклонять запрос`);
    }
  }
});

test('telegram (C6): отладочные эндпоинты закрыты в production, тикеты — только админам', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  // Тикеты: без входа 401, обычный пользователь 403
  const anon = await fetch(`${server.baseUrl}/api/telegram/support/tickets`);
  assert.equal(anon.status, 401);
  const reg = await signupAndVerify(server.baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'plain-user@example.com',
      password: 'password123',
      name: 'Plain',
    }),
  });
  const { token } = await readJson<AuthSession>(reg);
  const plain = await fetch(`${server.baseUrl}/api/telegram/support/tickets`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(plain.status, 403);

  // Симуляции: в production их нет
  const mutable = config as unknown as { enableMockBilling: boolean };
  const previous = mutable.enableMockBilling;
  mutable.enableMockBilling = false;
  try {
    const sim = await fetch(`${server.baseUrl}/api/telegram/simulate-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId: 'ultra', userId: 'anyone' }),
    });
    assert.equal(sim.status, 404);
    const simSupport = await fetch(`${server.baseUrl}/api/telegram/support/simulate-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'x' }),
    });
    assert.equal(simSupport.status, 404);
  } finally {
    mutable.enableMockBilling = previous;
  }
});
