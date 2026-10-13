import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { config } from '../config.js';
import { createInvoiceStore } from '../store/invoice-store.js';
import { createSubscriptionStore } from '../store/subscription-store.js';
import { createUserStore } from '../store/user-store.js';
import { TelegramBotService, decodePayload, encodePayload, type TelegramUpdate } from '../telegram/bot.js';
import { TelegramLinkCodes, telegramLinkCodes } from '../telegram/link-codes.js';
import { StarsRateService } from '../telegram/stars-rate.js';
import { signInitData, validateInitData } from '../telegram/webapp-auth.js';
import { readJson, startTestServer, type ApiErrorBody } from '../testing/server.js';
import type { AuthSession, Subscription } from '../types.js';

const TOKEN = '123456:TEST_TOKEN_abcdefghijklmnop';
const tgHeaders = { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': config.telegramWebhookSecret };

interface ApiCall {
  method: string;
  body: Record<string, unknown>;
}

/** Бот с подменённым Telegram API: все вызовы записываются. */
class RecordingBot extends TelegramBotService {
  calls: ApiCall[] = [];
  override async callApi<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | null> {
    this.calls.push({ method, body });
    if (method === 'createInvoiceLink') return 'https://t.me/$test_invoice' as T;
    return true as T;
  }
  last(method: string): ApiCall | undefined {
    return [...this.calls].reverse().find((call) => call.method === method);
  }
}

async function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'ketner-tg-'));
  const userStore = createUserStore(join(dir, 'users.json'));
  const subscriptionStore = createSubscriptionStore(join(dir, 'subs.json'));
  const invoiceStore = createInvoiceStore(join(dir, 'invoices.json'));
  // Общие коды: их выдаёт сайт (/api/auth/telegram-link), а принимает бот.
  const linkCodes = telegramLinkCodes;
  const rateService = new StarsRateService({ fetchImpl: (async () => new Response('', { status: 500 })) as typeof fetch });
  const bot = new RecordingBot({
    userStore,
    subscriptionStore,
    invoiceStore,
    botToken: TOKEN,
    botUsername: 'ketner_test_bot',
    linkCodes,
    rateService,
    webAppUrl: 'https://ketner.org',
  });
  const server = await startTestServer({}, { userStore, subscriptionStore, invoiceStore, botService: bot });
  let counter = 0;
  const signup = async (): Promise<AuthSession> => {
    counter += 1;
    const response = await fetch(`${server.baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `tg${counter}-${Date.now()}@example.com`, password: 'password123', name: 'Buyer' }),
    });
    return readJson<AuthSession>(response);
  };
  const send = (update: Omit<TelegramUpdate, 'update_id'>) =>
    fetch(`${server.baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: tgHeaders,
      body: JSON.stringify({ update_id: Date.now(), ...update }),
    });
  const message = (chatId: number, text: string) =>
    send({ message: { message_id: 1, date: 0, chat: { id: chatId, type: 'private' }, from: { id: chatId, first_name: 'Ivan' }, text } });
  const callback = (chatId: number, data: string) =>
    send({ callback_query: { id: 'cb', from: { id: chatId, first_name: 'Ivan' }, message: { message_id: 1, chat: { id: chatId } }, data } });
  return { server, bot, userStore, subscriptionStore, invoiceStore, linkCodes, rateService, signup, send, message, callback };
}

test('курс Stars: свежий курс Fragment применяется, устаревший или странный — нет', async () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  const feed = (body: unknown) => (async () => Response.json(body)) as unknown as typeof fetch;

  const fresh = new StarsRateService({ now: () => now, fetchImpl: feed({ usdt_per_star: 0.0149, last_updated: '2026-10-12T00:00:00Z' }) });
  assert.equal((await fresh.refresh()).source, 'fragment');
  assert.equal(fresh.quote(9), 610);
  assert.equal(fresh.quote(25), 1680);

  const stale = new StarsRateService({ now: () => now, fetchImpl: feed({ usdt_per_star: 0.0149, last_updated: '2026-01-09T00:00:00Z' }) });
  assert.deepEqual([(await stale.refresh()).source, stale.rate.usdPerStar], ['config', 0.015]);

  const absurd = new StarsRateService({ now: () => now, fetchImpl: feed({ usdt_per_star: 2, last_updated: '2026-10-12T00:00:00Z' }) });
  assert.equal((await absurd.refresh()).source, 'config');

  const down = new StarsRateService({ fetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
  assert.equal((await down.refresh()).usdPerStar, 0.015);
  assert.equal(down.quote(9), 600);
  assert.equal(down.quote(49), 3270);
});

test('initData мини-приложения: подпись и срок действия проверяются', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  const fields = { auth_date: String(now / 1000 - 60), query_id: 'q1', user: JSON.stringify({ id: 42, first_name: 'Ivan', username: 'ivan' }) };
  const signed = signInitData(fields, TOKEN);
  assert.equal(validateInitData(signed, TOKEN, { now })?.user.id, 42);
  assert.equal(validateInitData(signed, 'other:token', { now }), null);
  assert.equal(validateInitData(signed.replace('ivan', 'admin'), TOKEN, { now }), null);
  assert.equal(validateInitData(signed, TOKEN, { now: now + 2 * 24 * 3600 * 1000 }), null);
});

test('коды привязки одноразовые и живут 15 минут', () => {
  const codes = new TelegramLinkCodes();
  const code = codes.issue('user-1', 0);
  assert.equal(codes.consume(code, 1000), 'user-1');
  assert.equal(codes.consume(code, 1000), null);
  const late = codes.issue('user-2', 0);
  assert.equal(codes.consume(late, 16 * 60 * 1000), null);
  assert.match(codes.issue('user-3'), /^[A-Za-z0-9_-]{16}$/);
});

test('payload счёта: кодируется компактно и не принимает чужие тарифы', () => {
  const raw = encodePayload({ planId: 'pro', stars: 1670, invoiceId: 'stars_1_ab', userId: '7f3c2a10-1111-2222-3333-444455556666' });
  assert.ok(raw.length <= 128);
  assert.deepEqual(decodePayload(raw), { planId: 'pro', stars: 1670, invoiceId: 'stars_1_ab', userId: '7f3c2a10-1111-2222-3333-444455556666' });
  assert.equal(decodePayload('v1|free|10|x|u'), null);
  assert.equal(decodePayload('{"planId":"plus"}'), null);
});

test('бот: привязка по одноразовой ссылке с сайта, оплата звёздами, продление и защита от повторов', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const buyer = await h.signup();
  const auth = { Authorization: `Bearer ${buyer.token}` };
  const chatId = 777001;

  // Без привязки купить нельзя: оплата должна попасть на аккаунт.
  await h.callback(chatId, 'buy:plus');
  assert.equal(h.bot.last('sendInvoice'), undefined);
  assert.match(String(h.bot.last('sendMessage')?.body.text), /не привязан/);

  // Сайт выдаёт одноразовую ссылку, а не id пользователя.
  const link = await readJson<{ linkUrl: string }>(await fetch(`${h.server.baseUrl}/api/auth/telegram-link`, { headers: auth }));
  assert.match(link.linkUrl, /\?start=lnk_[A-Za-z0-9_-]{16}$/);
  assert.ok(!link.linkUrl.includes(buyer.user.id));
  const code = link.linkUrl.split('start=')[1]!;
  await h.message(chatId, `/start ${code}`);
  assert.equal(h.userStore.findByTelegramChatId(chatId)?.id, buyer.user.id);
  // Повторно по той же ссылке другой чат не привяжется.
  await h.message(888002, `/start ${code}`);
  assert.equal(h.userStore.findByTelegramChatId(888002), null);

  await h.callback(chatId, 'buy:pro');
  const invoice = h.bot.last('sendInvoice')!;
  assert.equal(invoice.body.currency, 'XTR');
  const prices = invoice.body.prices as Array<{ amount: number }>;
  assert.equal(prices[0]!.amount, h.rateService.quote(25));
  const payload = String(invoice.body.payload);

  // Перед списанием сумма сверяется со счётом.
  await h.send({ pre_checkout_query: { id: 'pc1', from: { id: chatId, first_name: 'Ivan' }, currency: 'XTR', total_amount: 10, invoice_payload: payload } });
  assert.equal(h.bot.last('answerPreCheckoutQuery')?.body.ok, false);
  await h.send({ pre_checkout_query: { id: 'pc2', from: { id: chatId, first_name: 'Ivan' }, currency: 'XTR', total_amount: prices[0]!.amount, invoice_payload: payload } });
  assert.equal(h.bot.last('answerPreCheckoutQuery')?.body.ok, true);

  const pay = (charge: string, raw = payload, amount = prices[0]!.amount) =>
    h.send({
      message: {
        message_id: 2,
        date: 0,
        chat: { id: chatId, type: 'private' },
        successful_payment: { currency: 'XTR', total_amount: amount, invoice_payload: raw, telegram_payment_charge_id: charge },
      },
    });
  await pay('charge-1');
  const first = h.subscriptionStore.get(buyer.user.id);
  assert.equal(first.plan, 'pro');
  const firstEnd = Date.parse(first.renewsAt!);
  assert.ok(Math.abs(firstEnd - (Date.now() + 30 * 864e5)) < 60_000);

  // Повторная доставка того же платежа ничего не продлевает.
  await pay('charge-1');
  await pay('charge-2');
  assert.equal(h.subscriptionStore.get(buyer.user.id).renewsAt, first.renewsAt);

  // Сайт видит оплату, а подтверждение не продлевает второй раз.
  const invoiceId = decodePayload(payload)!.invoiceId;
  const confirm = await fetch(`${h.server.baseUrl}/api/billing/telegram-stars/confirm/${invoiceId}`, { method: 'POST', headers: auth });
  assert.equal(confirm.status, 200);
  assert.equal(h.subscriptionStore.get(buyer.user.id).renewsAt, first.renewsAt);

  // Новый счёт на тот же тариф до окончания срока — дни добавляются, а не сгорают.
  await h.callback(chatId, 'buy:pro');
  const renewal = h.bot.last('sendInvoice')!;
  await pay('charge-3', String(renewal.body.payload), (renewal.body.prices as Array<{ amount: number }>)[0]!.amount);
  const extended = Date.parse(h.subscriptionStore.get(buyer.user.id).renewsAt!);
  assert.ok(Math.abs(extended - firstEnd - 30 * 864e5) < 60_000);
});

test('бот: напоминание о продлении приходит один раз', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const buyer = await h.signup();
  h.userStore.linkTelegram(buyer.user.id, 555001);
  const ends = new Date(Date.now() + 2.5 * 864e5).toISOString();
  h.subscriptionStore.set({ userId: buyer.user.id, plan: 'plus', status: 'active', renewsAt: ends } satisfies Subscription);
  assert.equal(await h.bot.sendRenewalReminders(), 1);
  assert.equal(await h.bot.sendRenewalReminders(), 0);
  const reminder = h.bot.last('sendMessage')!;
  assert.equal(reminder.body.chat_id, 555001);
  assert.match(String(reminder.body.text), /закончится/);
});

test('мини-приложение: вход по initData, привязка паролем, счёт в звёздах', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const buyer = await h.signup();
  const initData = signInitData(
    { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 990001, first_name: 'Anna', username: 'anna' }) },
    TOKEN,
  );
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${h.server.baseUrl}/api/telegram/miniapp/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  const forged = await post('session', { initData: initData.replace('Anna', 'Eve') });
  assert.equal(forged.status, 401);

  const guest = await readJson<{ linked: boolean }>(await post('session', { initData }));
  assert.equal(guest.linked, false);

  const wrong = await post('link', { initData, email: buyer.user.email, password: 'nope-nope' });
  assert.equal(wrong.status, 401);
  assert.equal((await readJson<ApiErrorBody>(wrong)).error.code, 'invalid_credentials');

  const linked = await readJson<{ linked: boolean; token: string; plans: Array<{ id: string; stars: number }> }>(
    await post('link', { initData, email: buyer.user.email, password: 'password123' }),
  );
  assert.equal(linked.linked, true);
  assert.deepEqual(linked.plans.map((plan) => plan.id), ['plus', 'pro', 'ultra']);
  assert.equal(linked.plans[0]!.stars, h.rateService.quote(9));
  assert.equal(h.userStore.findByTelegramChatId(990001)?.id, buyer.user.id);

  // Следующий запуск мини-приложения входит сразу.
  const again = await readJson<{ linked: boolean; user: { email: string } }>(await post('session', { initData }));
  assert.equal(again.user.email, buyer.user.email);

  const bearer = { Authorization: `Bearer ${linked.token}` };
  const invoice = await readJson<{ invoiceId: string; link: string; stars: number }>(await post('invoice', { planId: 'ultra' }, bearer));
  assert.equal(invoice.link, 'https://t.me/$test_invoice');
  assert.equal(invoice.stars, h.rateService.quote(49));
  const linkCall = h.bot.last('createInvoiceLink')!;
  assert.equal(decodePayload(String(linkCall.body.payload))?.userId, buyer.user.id);

  const status = await readJson<{ status: string }>(
    await fetch(`${h.server.baseUrl}/api/telegram/miniapp/invoice/${invoice.invoiceId}`, { headers: bearer }),
  );
  assert.equal(status.status, 'pending');

  const badPlan = await post('invoice', { planId: 'free' }, bearer);
  assert.equal(badPlan.status, 400);

  await post('unlink', {}, bearer);
  assert.equal(h.userStore.findByTelegramChatId(990001), null);
});

test('сайт: счёт в звёздах считается по текущему курсу', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const buyer = await h.signup();
  const created = await fetch(`${h.server.baseUrl}/api/billing/telegram-stars/create-invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${buyer.token}` },
    body: JSON.stringify({ planId: 'plus' }),
  });
  const { invoice } = await readJson<{ invoice: { starsAmount: number; botDeepLink: string; id: string } }>(created);
  assert.equal(invoice.starsAmount, 600);
  assert.match(invoice.botDeepLink, new RegExp(`\\?start=${invoice.id}$`));
});
