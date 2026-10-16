import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BillingService, createBillingLedger, DAY_MS } from '../billing/billing-service.js';
import { config } from '../config.js';
import { createInvoiceStore } from '../store/invoice-store.js';
import { createSupportStore } from '../store/support-store.js';
import { TelegramSupportBotService } from '../telegram/support-bot.js';
import { createSubscriptionStore } from '../store/subscription-store.js';
import { UsageStore } from '../store/usage-store.js';
import { createUserStore } from '../store/user-store.js';
import { TelegramAuthRequests, telegramAccountEmail } from '../telegram/auth-requests.js';
import type { MailMessage, Mailer } from '../services/mailer.js';
import {
  TelegramBotService,
  decodePayload,
  encodePayload,
  planStars,
  type TelegramUpdate,
} from '../telegram/bot.js';
import { STARS_OFFICIAL_USD_PER_STAR } from '../services/pricing.js';
import { TelegramLinkCodes, telegramLinkCodes } from '../telegram/link-codes.js';
import { StarsRateService } from '../telegram/stars-rate.js';
import { signInitData, validateInitData } from '../telegram/webapp-auth.js';
import { readJson, startTestServer, type ApiErrorBody } from '../testing/server.js';
import type { AuthSession, Subscription, User } from '../types.js';

const TOKEN = '123456:TEST_TOKEN_abcdefghijklmnop';
const tgHeaders = {
  'Content-Type': 'application/json',
  'X-Telegram-Bot-Api-Secret-Token': config.telegramWebhookSecret,
};

interface ApiCall {
  method: string;
  body: Record<string, unknown>;
}

/** Бот с подменённым Telegram API: все вызовы записываются. */
class RecordingBot extends TelegramBotService {
  calls: ApiCall[] = [];
  override async callApi<T = unknown>(
    method: string,
    body: Record<string, unknown>,
  ): Promise<T | null> {
    this.calls.push({ method, body });
    if (method === 'createInvoiceLink') return `https://t.me/$inv_${this.calls.length}` as T;
    return true as T;
  }
  last(method: string): ApiCall | undefined {
    return [...this.calls].reverse().find((call) => call.method === method);
  }
  all(method: string): ApiCall[] {
    return this.calls.filter((call) => call.method === method);
  }
}

interface MiniState {
  user: { id: string; email: string | null; telegramOnly: boolean; isAdmin: boolean };
  subscription: Subscription;
  autoRenew: { status: string; stars: number; nextChargeAt: string | null } | null;
  plans: Array<{
    id: string;
    stars: number;
    starsUsd: number;
    preview: { mode: string; bonusDays: number; renewsAt: string };
  }>;
  rate: { usdPerStar: number; source: string };
  payments: Array<{
    id: string;
    status: string;
    amount: number;
    refundOption: { kind: string; reason?: string };
  }>;
  prefs: { reminders: boolean; receipts: boolean };
}

async function harness(extra: Partial<Parameters<typeof startTestServer>[1]> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ketner-tg-'));
  const userStore = createUserStore(join(dir, 'users.json'));
  const subscriptionStore = createSubscriptionStore(join(dir, 'subs.json'));
  const invoiceStore = createInvoiceStore(join(dir, 'invoices.json'));
  const usageStore = new UsageStore(join(dir, 'usage.json'));
  const billingService = new BillingService({
    userStore,
    subscriptionStore,
    usageStore,
    ledger: createBillingLedger(),
  });
  const rateService = new StarsRateService({
    fetchImpl: (async () => new Response('', { status: 500 })) as typeof fetch,
  });
  const authRequests = new TelegramAuthRequests();
  /** Письма не уходят наружу: складываются сюда. */
  const mails: MailMessage[] = [];
  const mailer: Mailer = {
    kind: 'smtp',
    async send(message) {
      mails.push(message);
    },
  };
  const bot = new RecordingBot({
    userStore,
    subscriptionStore,
    invoiceStore,
    botToken: TOKEN,
    botUsername: 'ketner_test_bot',
    // Общие коды: их выдаёт сайт (/api/auth/telegram-link), а принимает бот.
    linkCodes: telegramLinkCodes,
    rateService,
    authRequests,
    billingService,
    webAppUrl: 'https://ketner.org',
  });
  const server = await startTestServer(
    {},
    {
      userStore,
      subscriptionStore,
      invoiceStore,
      usageStore,
      botService: bot,
      billingService,
      mailer,
      ...extra,
    },
  );
  let counter = 0;
  const signup = async (): Promise<AuthSession> => {
    counter += 1;
    const response = await fetch(`${server.baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `tg${counter}-${Date.now()}@example.com`,
        password: 'password123',
        name: 'Buyer',
      }),
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
    send({
      message: {
        message_id: 1,
        date: 0,
        chat: { id: chatId, type: 'private' },
        from: { id: chatId, first_name: 'Ivan', username: 'ivan' },
        text,
      },
    });
  const callback = (chatId: number, data: string) =>
    send({
      callback_query: {
        id: 'cb',
        from: { id: chatId, first_name: 'Ivan', username: 'ivan' },
        message: { message_id: 9, chat: { id: chatId } },
        data,
      },
    });
  const initData = (telegramUserId: number, firstName = 'Anna') =>
    signInitData(
      {
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: telegramUserId, first_name: firstName, username: 'anna' }),
      },
      TOKEN,
    );
  const mini = async <T>(
    path: string,
    body?: unknown,
    token?: string,
    method?: string,
  ): Promise<{ status: number; body: T }> => {
    const response = await fetch(`${server.baseUrl}/api/telegram/miniapp/${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await readJson<T>(response) };
  };
  /** Telegram сообщает об оплате звёздами. */
  const pay = (
    chatId: number,
    payload: string,
    amount: number,
    charge: string,
    extra: Record<string, unknown> = {},
  ) =>
    send({
      message: {
        message_id: 2,
        date: 0,
        chat: { id: chatId, type: 'private' },
        from: { id: chatId, first_name: 'Ivan' },
        successful_payment: {
          currency: 'XTR',
          total_amount: amount,
          invoice_payload: payload,
          telegram_payment_charge_id: charge,
          ...extra,
        },
      },
    });
  /** Привязанный к Telegram покупатель с токеном кабинета. */
  const linkedBuyer = async (telegramUserId: number) => {
    const buyer = await signup();
    const linked = await mini<{ token: string } & MiniState>('link', {
      initData: initData(telegramUserId),
      email: buyer.user.email,
      password: 'password123',
    });
    return { buyer, token: linked.body.token };
  };
  return {
    server,
    bot,
    userStore,
    subscriptionStore,
    invoiceStore,
    usageStore,
    billingService,
    rateService,
    authRequests,
    signup,
    send,
    message,
    callback,
    initData,
    mini,
    pay,
    linkedBuyer,
    mails,
  };
}

/** Код из последнего письма о привязке Telegram. */
function codeFromMail(mail: MailMessage | undefined): string {
  const match = /: (\d{6})/.exec(mail?.text ?? '');
  assert.ok(match, 'в письме есть шестизначный код');
  return match[1]!;
}

// ───────────── базовые кирпичики ─────────────

test('курс Stars: цена — по официальному курсу Telegram, Fragment только для сравнения', async () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  const feed = (body: unknown) => (async () => Response.json(body)) as unknown as typeof fetch;
  const fresh = new StarsRateService({
    now: () => now,
    fetchImpl: feed({ usdt_per_star: 0.0149, last_updated: '2026-10-12T00:00:00Z' }),
  });
  const rate = await fresh.refresh();
  assert.equal(rate.source, 'official');
  assert.equal(rate.usdPerStar, STARS_OFFICIAL_USD_PER_STAR);
  assert.deepEqual(rate.market, { usdPerStar: 0.0149, updatedAt: '2026-10-12T00:00:00.000Z' });
  // Рыночный курс на цену не влияет: по нему Plus стоил бы 610 ⭐ ($12.19 по официальному курсу).
  assert.deepEqual([fresh.quote(9), fresh.quote(25), fresh.quote(49)], [460, 1260, 2460]);
  assert.equal(fresh.toUsd(1000), 19.99);

  const stale = new StarsRateService({
    now: () => now,
    fetchImpl: feed({ usdt_per_star: 0.0149, last_updated: '2026-01-09T00:00:00Z' }),
  });
  assert.equal((await stale.refresh()).market, null, 'устаревший курс не показывается');
  const absurd = new StarsRateService({
    now: () => now,
    fetchImpl: feed({ usdt_per_star: 2, last_updated: '2026-10-12T00:00:00Z' }),
  });
  assert.equal((await absurd.refresh()).market, null);
  const down = new StarsRateService({
    fetchImpl: (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch,
  });
  await down.refresh();
  assert.deepEqual([down.quote(9), down.quote(25), down.quote(49)], [460, 1260, 2460]);

  // Свой курс (если Telegram изменит прайс) — только в правдоподобных границах.
  assert.equal(new StarsRateService({ usdPerStar: 0.025 }).rate.source, 'config');
  assert.equal(new StarsRateService({ usdPerStar: 5 }).rate.source, 'official');
});

test('initData мини-приложения: подпись и срок действия проверяются', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  const signed = signInitData(
    {
      auth_date: String(now / 1000 - 60),
      user: JSON.stringify({ id: 42, first_name: 'Ivan', username: 'ivan' }),
    },
    TOKEN,
  );
  assert.equal(validateInitData(signed, TOKEN, { now })?.user.id, 42);
  assert.equal(validateInitData(signed, 'other:token', { now }), null);
  assert.equal(validateInitData(signed.replace('ivan', 'admin'), TOKEN, { now }), null);
  assert.equal(validateInitData(signed, TOKEN, { now: now + 2 * DAY_MS }), null);
});

test('коды привязки и payload счёта', () => {
  const codes = new TelegramLinkCodes();
  const code = codes.issue('user-1', 0);
  assert.equal(codes.consume(code, 1000), 'user-1');
  assert.equal(codes.consume(code, 1000), null);

  const raw = encodePayload({
    planId: 'pro',
    stars: 1670,
    invoiceId: 'stars_1_ab',
    userId: '7f3c2a10-1111-2222-3333-444455556666',
    recurring: true,
  });
  assert.ok(raw.length <= 128);
  assert.equal(decodePayload(raw)?.recurring, true);
  assert.equal(decodePayload('v1|free|10|x|u'), null);

  const auth = new TelegramAuthRequests();
  const claim = auth.issueClaimCode(7, 'x', 0);
  assert.match(claim.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.deepEqual(auth.consumeClaimCode(claim.code.toLowerCase(), 1000), {
    telegramUserId: 7,
    username: 'x',
  });
  assert.equal(auth.consumeClaimCode(claim.code, 1000), null);
});

// ───────────── вход и привязка ─────────────

test('вход на сайт через Telegram: без привязки аккаунт не создаётся, после привязки — вход и сессия один раз', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const startLogin = async () =>
    readJson<{ requestId: string; botUrl: string }>(
      await fetch(`${h.server.baseUrl}/api/auth/telegram/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0',
        },
        body: JSON.stringify({ mode: 'login' }),
      }),
    );
  const pollOf = async (requestId: string) =>
    readJson<{ status: string; token?: string; user?: User }>(
      await fetch(`${h.server.baseUrl}/api/auth/telegram/poll/${requestId}`),
    );
  const usersBefore = h.userStore.list().length;

  // 1. Telegram не привязан: бот объясняет, как привязать, сайт получает «unlinked».
  const first = await startLogin();
  assert.match(first.botUrl, /^https:\/\/t\.me\/ketner_test_bot\?start=auth_[A-Za-z0-9_-]{16}$/);
  assert.equal((await pollOf(first.requestId)).status, 'pending');
  await h.message(7001, `/start auth_${first.botUrl.split('start=auth_')[1]!}`);
  assert.match(String(h.bot.last('sendMessage')!.body.text), /не привязан к аккаунту/);
  assert.equal((await pollOf(first.requestId)).status, 'unlinked');
  assert.equal(h.userStore.list().length, usersBefore, 'аккаунт не создан');
  assert.equal(h.userStore.findByTelegramChatId(7001), null);

  // Старая кнопка подтверждения тоже ничего не создаёт.
  const stale = await startLogin();
  const staleCode = stale.botUrl.split('start=auth_')[1]!;
  await h.callback(7001, `auth:y:${staleCode}`);
  assert.equal((await pollOf(stale.requestId)).status, 'unlinked');
  assert.equal(h.userStore.list().length, usersBefore);

  // 2. Привязка по коду из письма, затем вход проходит в этот аккаунт.
  const site = await h.signup();
  await h.mini('email-code', { initData: h.initData(7001), email: site.user.email });
  await h.mini('email-verify', { initData: h.initData(7001), code: codeFromMail(h.mails.at(0)) });
  assert.equal(h.userStore.findByTelegramChatId(7001)?.id, site.user.id);

  const login = await startLogin();
  const code = login.botUrl.split('start=auth_')[1]!;
  await h.message(7001, `/start auth_${code}`);
  const prompt = String(h.bot.last('sendMessage')!.body.text);
  assert.match(prompt, /Вход на ketner\.org/);
  assert.match(prompt, /Chrome · Windows/);
  await h.callback(7001, `auth:y:${code}`);
  const approved = await pollOf(login.requestId);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.user!.id, site.user.id);
  // Повторный опрос сессию не отдаёт.
  assert.equal((await pollOf(login.requestId)).status, 'expired');
  const me = await readJson<{ user: User }>(
    await fetch(`${h.server.baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${approved.token}` },
    }),
  );
  assert.equal(me.user.id, site.user.id);

  // «Это не я» — отказ.
  const again = await startLogin();
  const code2 = again.botUrl.split('start=auth_')[1]!;
  await h.message(7001, `/start auth_${code2}`);
  await h.callback(7001, `auth:n:${code2}`);
  assert.equal((await pollOf(again.requestId)).status, 'declined');
});

test('привязка из настроек: подтверждение в боте, код из кабинета, вход на сайт из кабинета', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const site = await h.signup();
  const auth = { Authorization: `Bearer ${site.token}`, 'Content-Type': 'application/json' };

  const unauthorized = await fetch(`${h.server.baseUrl}/api/auth/telegram/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'link' }),
  });
  assert.equal(unauthorized.status, 401);

  const start = await readJson<{ requestId: string; botUrl: string }>(
    await fetch(`${h.server.baseUrl}/api/auth/telegram/start`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ mode: 'link' }),
    }),
  );
  const code = start.botUrl.split('start=auth_')[1]!;
  await h.message(7101, `/start auth_${code}`);
  assert.match(
    String(h.bot.last('sendMessage')!.body.text),
    new RegExp(site.user.email.replace(/[.]/g, '\\.')),
  );
  await h.callback(7101, `auth:y:${code}`);
  assert.equal(h.userStore.findByTelegramChatId(7101)?.id, site.user.id);
  const linkPoll = await readJson<{ status: string; mode: string; token?: string }>(
    await fetch(`${h.server.baseUrl}/api/auth/telegram/poll/${start.requestId}`),
  );
  assert.deepEqual(
    [linkPoll.status, linkPoll.mode, linkPoll.token],
    ['approved', 'link', undefined],
  );

  // Код из кабинета для второго аккаунта (например, вход через Google на другом устройстве).
  const other = await h.signup();
  const claim = await h.mini<{ code: string }>('link-code', { initData: h.initData(7202) });
  const claimed = await fetch(`${h.server.baseUrl}/api/auth/telegram/claim`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${other.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: claim.body.code }),
  });
  assert.equal(claimed.status, 200);
  assert.equal(h.userStore.findByTelegramChatId(7202)?.id, other.user.id);
  const reused = await fetch(`${h.server.baseUrl}/api/auth/telegram/claim`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${other.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: claim.body.code }),
  });
  assert.equal(reused.status, 400);

  // Кабинет открывает сайт уже войдя: ссылка одноразовая.
  const session = await h.mini<{ token: string }>('session', { initData: h.initData(7202) });
  const magic = await h.mini<{ url: string }>(
    'site-login',
    { next: '/settings' },
    session.body.token,
  );
  const url = new URL(magic.body.url);
  assert.equal(url.origin + url.pathname, 'https://ketner.org/auth/telegram');
  assert.equal(url.searchParams.get('next'), '/settings');
  const exchange = () =>
    fetch(`${h.server.baseUrl}/api/auth/telegram/magic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: url.searchParams.get('t') }),
    });
  const first = await exchange();
  assert.equal((await readJson<{ user: User }>(first)).user.id, other.user.id);
  assert.equal((await exchange()).status, 400);
});

test('кабинет: регистрации в Telegram нет, привязка по коду из письма', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const guest = await h.mini<{ linked: boolean }>('session', { initData: h.initData(7301) });
  assert.equal(guest.body.linked, false);
  // Создать аккаунт из Telegram больше нельзя.
  const register = await h.mini<ApiErrorBody>('register', { initData: h.initData(7301) });
  assert.equal(register.status, 404);

  const site = await h.signup();
  const bad = await h.mini<ApiErrorBody>('email-code', {
    initData: h.initData(7301),
    email: 'не почта',
  });
  assert.equal(bad.status, 400);

  // Незнакомая почта: ответ тот же, но письма нет (адреса не перебрать).
  const unknown = await h.mini<{ sent: boolean }>('email-code', {
    initData: h.initData(7301),
    email: 'nobody@example.com',
  });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.sent, true);
  assert.equal(h.mails.length, 0);

  const sent = await h.mini<{ sent: boolean }>('email-code', {
    initData: h.initData(7301, 'Мария'),
    email: ` ${site.user.email.toUpperCase()} `,
  });
  assert.equal(sent.status, 200);
  assert.equal(h.mails.length, 1);
  assert.equal(h.mails[0]!.to, site.user.email);
  assert.match(h.mails[0]!.text, /@anna/);
  assert.match(h.mails[0]!.text, /Никому не сообщайте/);
  const code = codeFromMail(h.mails[0]);

  // Повторно сразу нельзя.
  const tooSoon = await h.mini<ApiErrorBody>('email-code', {
    initData: h.initData(7301),
    email: site.user.email,
  });
  assert.equal(tooSoon.status, 429);

  // Чужой Telegram этим кодом не воспользуется.
  const foreign = await h.mini<ApiErrorBody>('email-verify', { initData: h.initData(7399), code });
  assert.equal(foreign.status, 400);

  const wrong = await h.mini<ApiErrorBody>('email-verify', {
    initData: h.initData(7301),
    code: code === '000000' ? '111111' : '000000',
  });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error.code, 'code_invalid');

  const linked = await h.mini<{ linked: boolean; token: string } & MiniState>('email-verify', {
    initData: h.initData(7301),
    code: code.split('').join(' '),
  });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.linked, true);
  assert.equal(linked.body.user.id, site.user.id);
  assert.equal(h.userStore.findByTelegramChatId(7301)?.id, site.user.id);
  // Владелец почты узнаёт о привязке.
  assert.match(h.mails.at(-1)!.subject, /привязан Telegram/);
  // Код одноразовый.
  const reused = await h.mini<ApiErrorBody>('email-verify', { initData: h.initData(7301), code });
  assert.equal(reused.status, 400);

  const forged = await h.mini<ApiErrorBody>('session', {
    initData: h.initData(7301).replace('Anna', 'Eve'),
  });
  assert.equal(forged.status, 401);
});

test('кабинет: код сгорает после 5 неверных попыток, служебные адреса Telegram не принимаются', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const site = await h.signup();
  await h.mini('email-code', { initData: h.initData(7501), email: site.user.email });
  const code = codeFromMail(h.mails.at(-1));
  const wrongCode = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 4; i += 1) {
    const r = await h.mini<ApiErrorBody>('email-verify', {
      initData: h.initData(7501),
      code: wrongCode,
    });
    assert.equal(r.body.error.code, 'code_invalid');
  }
  const burned = await h.mini<ApiErrorBody>('email-verify', {
    initData: h.initData(7501),
    code: wrongCode,
  });
  assert.equal(burned.body.error.code, 'code_attempts');
  const late = await h.mini<ApiErrorBody>('email-verify', { initData: h.initData(7501), code });
  assert.equal(late.body.error.code, 'code_missing');
  assert.equal(h.userStore.findByTelegramChatId(7501), null);

  // Старый аккаунт, созданный когда-то в Telegram: вход работает, отвязать нельзя,
  // а его служебный адрес не годится для кода.
  const legacy = h.userStore.create(telegramAccountEmail(7601), 'legacy-password-123456', 'Мария');
  h.userStore.linkTelegram(legacy.id, 7601, 'maria');
  const mailsBefore = h.mails.length;
  await h.mini('email-code', { initData: h.initData(7602), email: legacy.email });
  assert.equal(h.mails.length, mailsBefore);
  const legacySession = await h.mini<{ linked: boolean; token: string } & MiniState>('session', {
    initData: h.initData(7601),
  });
  assert.equal(legacySession.body.linked, true);
  assert.equal(legacySession.body.user.telegramOnly, true);
  const unlink = await h.mini<ApiErrorBody>('unlink', {}, legacySession.body.token);
  assert.equal(unlink.status, 409);
  assert.equal(unlink.body.error.code, 'telegram_only_account');
});

// ───────────── оплата, продление, смена тарифа ─────────────

test('оплата звёздами: чек в журнале, продление добавляет дни, смена тарифа пересчитывает остаток', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const { buyer, token } = await h.linkedBuyer(7401);

  const invoice = await h.mini<{ invoiceId: string; link: string; stars: number }>(
    'invoice',
    { planId: 'plus' },
    token,
  );
  assert.equal(invoice.body.stars, planStars('plus', h.rateService));
  const linkCall = h.bot.last('createInvoiceLink')!;
  assert.equal(linkCall.body.subscription_period, undefined);
  const payload = String(linkCall.body.payload);

  // Перед списанием сумма сверяется со счётом.
  await h.send({
    pre_checkout_query: {
      id: 'pc',
      from: { id: 7401, first_name: 'Ivan' },
      currency: 'XTR',
      total_amount: 10,
      invoice_payload: payload,
    },
  });
  assert.equal(h.bot.last('answerPreCheckoutQuery')?.body.ok, false);

  await h.pay(7401, payload, invoice.body.stars, 'ch-1');
  await h.pay(7401, payload, invoice.body.stars, 'ch-1'); // повторная доставка
  const afterFirst = h.subscriptionStore.get(buyer.user.id);
  assert.equal(afterFirst.plan, 'plus');
  const firstEnd = Date.parse(afterFirst.renewsAt!);
  assert.ok(Math.abs(firstEnd - (Date.now() + 30 * DAY_MS)) < 60_000);

  const state = await h.mini<MiniState>('state', undefined, token);
  assert.equal(state.body.payments.length, 1);
  assert.equal(state.body.payments[0]!.refundOption.kind, 'request');
  const plusPlan = state.body.plans.find((plan) => plan.id === 'plus')!;
  assert.equal(plusPlan.preview.mode, 'extend');
  // Кабинет показывает ту же цену, что попадёт в счёт, и её цену по официальному курсу Telegram.
  assert.equal(plusPlan.stars, invoice.body.stars);
  assert.equal(plusPlan.starsUsd, 9.2);
  assert.deepEqual(
    state.body.plans.map((plan) => plan.stars),
    [460, 1260, 2460],
  );
  assert.equal(state.body.rate.source, 'official');
  const ultraPlan = state.body.plans.find((plan) => plan.id === 'ultra')!;
  assert.equal(ultraPlan.preview.mode, 'switch');
  // 30 дней Plus ($9) ≈ 5 дней Ultra ($49).
  assert.equal(ultraPlan.preview.bonusDays, 5);

  // Продление того же тарифа: +30 дней к сроку.
  const renew = await h.mini<{ invoiceId: string; stars: number }>(
    'invoice',
    { planId: 'plus' },
    token,
  );
  await h.pay(
    7401,
    String(h.bot.last('createInvoiceLink')!.body.payload),
    renew.body.stars,
    'ch-2',
  );
  const extended = Date.parse(h.subscriptionStore.get(buyer.user.id).renewsAt!);
  assert.ok(Math.abs(extended - firstEnd - 30 * DAY_MS) < 60_000);

  // Смена на Ultra: 30 дней + пересчёт ~60 дней Plus.
  const upgrade = await h.mini<{ invoiceId: string; stars: number }>(
    'invoice',
    { planId: 'ultra' },
    token,
  );
  await h.pay(
    7401,
    String(h.bot.last('createInvoiceLink')!.body.payload),
    upgrade.body.stars,
    'ch-3',
  );
  const ultra = h.subscriptionStore.get(buyer.user.id);
  assert.equal(ultra.plan, 'ultra');
  const ultraDays = Math.round((Date.parse(ultra.renewsAt!) - Date.now()) / DAY_MS);
  assert.ok(ultraDays >= 40 && ultraDays <= 41, `ultraDays=${ultraDays}`);
  assert.match(String(h.bot.last('sendMessage')!.body.text), /добавили 1[01] дн\./);
  assert.equal(h.userStore.findById(buyer.user.id)?.plan, 'ultra');
});

test('автопродление звёздами: подписка, очередное списание, отключение', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const { buyer, token } = await h.linkedBuyer(7501);

  const invoice = await h.mini<{ stars: number; recurring: boolean }>(
    'invoice',
    { planId: 'pro', recurring: true },
    token,
  );
  assert.equal(invoice.body.recurring, true);
  const linkCall = h.bot.last('createInvoiceLink')!;
  assert.equal(linkCall.body.subscription_period, 2592000);
  const payload = String(linkCall.body.payload);
  assert.equal(decodePayload(payload)?.recurring, true);

  const firstExpiry = Math.floor((Date.now() + 30 * DAY_MS) / 1000);
  await h.pay(7501, payload, invoice.body.stars, 'sub-1', {
    is_recurring: true,
    is_first_recurring: true,
    subscription_expiration_date: firstExpiry,
  });
  let state = await h.mini<MiniState>('state', undefined, token);
  assert.equal(state.body.autoRenew?.status, 'active');
  assert.equal(state.body.autoRenew?.stars, invoice.body.stars);
  const firstEnd = Date.parse(state.body.subscription.renewsAt!);

  // Через 30 дней Telegram списывает сам и присылает платёж с тем же payload.
  await h.pay(7501, payload, invoice.body.stars, 'sub-2', {
    is_recurring: true,
    subscription_expiration_date: firstExpiry + 30 * 86400,
  });
  state = await h.mini<MiniState>('state', undefined, token);
  assert.ok(
    Math.abs(Date.parse(state.body.subscription.renewsAt!) - firstEnd - 30 * DAY_MS) < 60_000,
  );
  assert.equal(state.body.payments.length, 2);
  assert.match(String(h.bot.last('sendMessage')!.body.text), /Автопродление прошло/);

  const off = await h.mini<MiniState>('auto-renew', { enabled: false }, token);
  assert.equal(off.body.autoRenew?.status, 'canceled');
  const edit = h.bot.last('editUserStarSubscription')!;
  assert.deepEqual(edit.body, {
    user_id: 7501,
    telegram_payment_charge_id: 'sub-1',
    is_canceled: true,
  });
  assert.equal(h.subscriptionStore.get(buyer.user.id).plan, 'pro');
});

// ───────────── возвраты ─────────────

test('возврат звёзд: только после одобрения администратора, затем срок откатывается', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const { buyer, token } = await h.linkedBuyer(7601);
  const invoice = await h.mini<{ stars: number }>('invoice', { planId: 'pro' }, token);
  await h.pay(
    7601,
    String(h.bot.last('createInvoiceLink')!.body.payload),
    invoice.body.stars,
    'rf-1',
  );
  assert.equal(h.subscriptionStore.get(buyer.user.id).plan, 'pro');

  const paymentId = encodeURIComponent('stars:rf-1');
  const refund = await h.mini<{ outcome: string } & MiniState>(
    `payments/${paymentId}/refund`,
    { reason: 'Не подошло' },
    token,
  );
  assert.equal(refund.body.outcome, 'requested');
  assert.equal(
    h.bot.all('refundStarPayment').length,
    0,
    'без решения администратора звёзды не возвращаются',
  );
  assert.equal(h.subscriptionStore.get(buyer.user.id).plan, 'pro');
  assert.equal(refund.body.payments[0]!.status, 'refund_requested');

  await h.billingService.decideRefund('stars:rf-1', true);
  assert.deepEqual(h.bot.last('refundStarPayment')!.body, {
    user_id: 7601,
    telegram_payment_charge_id: 'rf-1',
  });
  assert.equal(h.subscriptionStore.get(buyer.user.id).plan, 'free');
  assert.equal(h.userStore.findById(buyer.user.id)?.plan, 'free');
  const after = await h.mini<MiniState>('state', undefined, token);
  assert.equal(after.body.payments[0]!.status, 'refunded');
  assert.deepEqual(after.body.payments[0]!.refundOption, { kind: 'none', reason: 'refunded' });

  const again = await h.mini<ApiErrorBody>(`payments/${paymentId}/refund`, {}, token);
  assert.equal(again.body.error.code, 'refund_refunded');
});

/** Запись об ответе модели — так выглядит «использование» для правил возврата. */
function useModel(usageStore: UsageStore, userId: string, status: 'success' | 'error' = 'success') {
  usageStore.recordUsage({
    userId,
    conversationId: 'c1',
    modelId: 'ketner-mini',
    provider: 'openrouter' as never,
    inputTokens: 10,
    outputTokens: 20,
    estimatedCost: 0,
    latencyMs: 100,
    status,
  });
}

test('возврат: только 24 часа и без единого запроса к моделям', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const { buyer, token } = await h.linkedBuyer(7650);

  // Оплата двое суток назад — срок вышел.
  h.billingService.grant(
    buyer.user.id,
    'plus',
    {
      id: 'stars:old-1',
      method: 'stars',
      amount: 600,
      currency: 'XTR',
      chargeId: 'old-1',
      telegramUserId: 7650,
    },
    Date.now() - 2 * DAY_MS,
  );
  const expired = await h.mini<ApiErrorBody>(
    `payments/${encodeURIComponent('stars:old-1')}/refund`,
    { reason: 'Не подошло' },
    token,
  );
  assert.equal(expired.status, 409);
  assert.equal(expired.body.error.code, 'refund_expired');

  // Свежая оплата, но модель уже ответила — вернуть нельзя.
  h.billingService.grant(buyer.user.id, 'pro', {
    id: 'stars:used-1',
    method: 'stars',
    amount: 1670,
    currency: 'XTR',
    chargeId: 'used-1',
    telegramUserId: 7650,
  });
  const fresh = h.billingService.findPayment('stars:used-1')!;
  assert.deepEqual(h.billingService.refundOption(fresh), { kind: 'request' });
  // Ошибка модели использованием не считается.
  useModel(h.usageStore, buyer.user.id, 'error');
  assert.deepEqual(h.billingService.refundOption(fresh), { kind: 'request' });
  useModel(h.usageStore, buyer.user.id);
  assert.deepEqual(h.billingService.refundOption(fresh), { kind: 'none', reason: 'used' });
  const used = await h.mini<ApiErrorBody>(
    `payments/${encodeURIComponent('stars:used-1')}/refund`,
    {},
    token,
  );
  assert.equal(used.body.error.code, 'refund_used');
  assert.match(used.body.error.message, /24 часов/);
  assert.equal(h.bot.all('refundStarPayment').length, 0);
});

test('возврат криптовалюты: заявка администратору, решение кнопкой в боте или в кабинете', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const admin = await h.linkedBuyer(7701);
  h.userStore.setAdmin(admin.buyer.user.id, true);
  const { buyer, token } = await h.linkedBuyer(7702);

  h.billingService.grant(buyer.user.id, 'pro', {
    id: 'crypto:c-1',
    method: 'crypto',
    amount: 25,
    currency: 'USD',
  });
  assert.deepEqual(h.billingService.refundOption(h.billingService.findPayment('crypto:c-1')!), {
    kind: 'request',
  });
  const requested = await h.mini<{ outcome: string }>(
    `payments/${encodeURIComponent('crypto:c-1')}/refund`,
    { reason: 'Ошибся тарифом', comment: 'Хотел Plus' },
    token,
  );
  assert.equal(requested.body.outcome, 'requested');
  const adminMessage = h.bot.all('sendMessage').find((call) => call.body.chat_id === 7701)!;
  assert.match(String(adminMessage.body.text), /Заявка на возврат/);
  assert.match(String(adminMessage.body.text), /Хотел Plus/);
  assert.match(String(adminMessage.body.text), /Запросов к моделям после оплаты: 0/);
  const buttons = (
    adminMessage.body.reply_markup as { inline_keyboard: Array<Array<{ callback_data?: string }>> }
  ).inline_keyboard[0]!;
  const approve = buttons[0]!.callback_data!;
  assert.match(approve, /^rf:y:/);

  // Не администратор нажать не может.
  await h.callback(7702, approve);
  assert.equal(h.billingService.findPayment('crypto:c-1')?.status, 'refund_requested');

  // Кабинет администратора видит заявку и сколько клиент успел воспользоваться.
  const list = await h.mini<{ refunds: Array<{ id: string; usedRequests: number }> }>(
    'admin/refunds',
    undefined,
    admin.token,
  );
  assert.deepEqual(
    list.body.refunds.map((refund) => [refund.id, refund.usedRequests]),
    [['crypto:c-1', 0]],
  );
  const forbidden = await h.mini<ApiErrorBody>('admin/refunds', undefined, token);
  assert.equal(forbidden.status, 403);

  await h.callback(7701, approve);
  assert.equal(h.billingService.findPayment('crypto:c-1')?.status, 'refunded');
  assert.equal(h.subscriptionStore.get(buyer.user.id).plan, 'free');

  // Вторая заявка — отказ из кабинета администратора с пояснением.
  h.billingService.grant(buyer.user.id, 'plus', {
    id: 'crypto:c-2',
    method: 'crypto',
    amount: 9,
    currency: 'USD',
  });
  await h.mini(`payments/${encodeURIComponent('crypto:c-2')}/refund`, { reason: 'Другое' }, token);
  const decided = await h.mini<{ payment: { status: string } }>(
    `admin/refunds/${encodeURIComponent('crypto:c-2')}`,
    { approve: false, note: 'Перевод не найден' },
    admin.token,
  );
  assert.equal(decided.body.payment.status, 'refund_declined');
  assert.match(
    String(
      h.bot
        .all('sendMessage')
        .filter((call) => call.body.chat_id === 7702)
        .at(-1)!.body.text,
    ),
    /Перевод не найден/,
  );
});

test('возврат, оформленный Telegram (refunded_payment), откатывает срок', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const { buyer, token } = await h.linkedBuyer(7801);
  const invoice = await h.mini<{ stars: number }>('invoice', { planId: 'plus' }, token);
  const payload = String(h.bot.last('createInvoiceLink')!.body.payload);
  await h.pay(7801, payload, invoice.body.stars, 'tg-ref');
  await h.send({
    message: {
      message_id: 3,
      date: 0,
      chat: { id: 7801, type: 'private' },
      refunded_payment: {
        currency: 'XTR',
        total_amount: invoice.body.stars,
        invoice_payload: payload,
        telegram_payment_charge_id: 'tg-ref',
      },
    },
  });
  assert.equal(h.billingService.findPayment('stars:tg-ref')?.status, 'refunded');
  assert.equal(h.subscriptionStore.get(buyer.user.id).plan, 'free');
});

// ───────────── бот: команды и напоминания ─────────────

test('бот: /start ведёт в кабинет, /paysupport и /terms объясняют возвраты', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  await h.message(7901, '/start');
  const start = h.bot.last('sendMessage')!;
  const button = (
    start.body.reply_markup as { inline_keyboard: Array<Array<{ web_app?: { url: string } }>> }
  ).inline_keyboard[0]![0]!;
  assert.equal(button.web_app?.url, 'https://ketner.org/tg');
  await h.message(7901, '/paysupport');
  assert.match(
    String(h.bot.last('sendMessage')!.body.text),
    /в течение 24 часов, если после неё вы не сделали ни одного запроса/,
  );
  await h.message(7901, '/terms');
  assert.match(String(h.bot.last('sendMessage')!.body.text), /оплата не возвращается/);
});

test('напоминания: с автопродлением — о списании, отключённые — не приходят', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const { buyer, token } = await h.linkedBuyer(8001);
  const ends = new Date(Date.now() + 2.5 * DAY_MS).toISOString();
  h.subscriptionStore.set({
    userId: buyer.user.id,
    plan: 'plus',
    status: 'active',
    renewsAt: ends,
  });
  await h.billingService.startStarsSubscription({
    userId: buyer.user.id,
    planId: 'plus',
    telegramUserId: 8001,
    chargeId: 'c',
    invoiceId: 'i',
    stars: 600,
    nextChargeAt: ends,
  });
  assert.equal(await h.bot.sendRenewalReminders(), 1);
  assert.match(String(h.bot.last('sendMessage')!.body.text), /автоматически продлим/);
  assert.equal(await h.bot.sendRenewalReminders(), 0);

  const other = await h.linkedBuyer(8002);
  h.subscriptionStore.set({
    userId: other.buyer.user.id,
    plan: 'pro',
    status: 'active',
    renewsAt: ends,
  });
  await h.mini('prefs', { reminders: false }, other.token);
  assert.equal(await h.bot.sendRenewalReminders(), 0);
  void token;
});

test('сайт: счёт в звёздах — цена тарифа по официальному курсу Telegram', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const buyer = await h.signup();
  const created = await fetch(`${h.server.baseUrl}/api/billing/telegram-stars/create-invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${buyer.token}` },
    body: JSON.stringify({ planId: 'plus' }),
  });
  const { invoice } = await readJson<{
    invoice: {
      starsAmount: number;
      botDeepLink: string;
      id: string;
      starsUsd: number;
      usdPerStar: number;
    };
  }>(created);
  // Plus $9 по официальному курсу Telegram — 460 ⭐ ($9.20 у Telegram, округление до 10 ⭐).
  assert.equal(invoice.starsAmount, 460);
  assert.equal(invoice.starsUsd, 9.2);
  assert.equal(invoice.usdPerStar, STARS_OFFICIAL_USD_PER_STAR);
  assert.match(invoice.botDeepLink, new RegExp(`\\?start=${invoice.id}$`));
});

// ───────────── пакеты премиум-квоты за звёзды ─────────────

test('пакет за звёзды: только на платном тарифе; оплата начисляет кредиты, повтор — нет', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const buyer = await h.signup();
  const auth = { Authorization: `Bearer ${buyer.token}`, 'Content-Type': 'application/json' };
  const createPack = () =>
    fetch(`${h.server.baseUrl}/api/billing/telegram-stars/create-invoice`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ packId: 'premium-5' }),
    });

  // На Free премиум-моделей нет — пакет не продаётся.
  const denied = await createPack();
  assert.equal(denied.status, 403);
  assert.equal((await readJson<ApiErrorBody>(denied)).error.code, 'plan_required');

  h.billingService.grant(buyer.user.id, 'pro', {
    id: 'crypto:plan-for-pack',
    method: 'crypto',
    amount: 25,
    currency: 'USD',
  });
  const created = await createPack();
  assert.equal(created.status, 200);
  const { invoice } = await readJson<{
    invoice: { id: string; packId: string; starsAmount: number };
  }>(created);
  assert.equal(invoice.packId, 'premium-5');
  assert.equal(invoice.starsAmount, h.rateService.quote(9));

  const payload = encodePayload({
    packId: 'premium-5',
    stars: invoice.starsAmount,
    invoiceId: invoice.id,
    userId: buyer.user.id,
  });
  assert.equal(h.bot.validatePayment('XTR', invoice.starsAmount, payload).ok, true);
  await h.pay(777001, payload, invoice.starsAmount, 'charge-pack-1');
  await h.pay(777001, payload, invoice.starsAmount, 'charge-pack-1');

  const packs = await readJson<{
    packs: Array<{ id: string; priceUsd: number; quotaUsd: number }>;
    credits: { remainingUsd: number; items: Array<{ id: string }> };
  }>(await fetch(`${h.server.baseUrl}/api/billing/packs`, { headers: auth }));
  assert.deepEqual(
    packs.packs.map((p) => p.id),
    ['premium-3', 'premium-5', 'premium-10'],
  );
  assert.equal(packs.credits.remainingUsd, 5);
  assert.equal(packs.credits.items.length, 1, 'повторная доставка платежа не начисляет второй раз');
  // Подписка от пакета не меняется.
  assert.equal(h.subscriptionStore.get(buyer.user.id).plan, 'pro');

  // Возврат: пока из пакета ничего не потрачено — звёзды возвращаются сразу; потом — нет.
  const payment = h.billingService.findPayment('stars:charge-pack-1')!;
  assert.equal(payment.packId, 'premium-5');
  assert.deepEqual(h.billingService.refundOption(payment), { kind: 'request' });
  h.billingService.ledger.credits.debit(buyer.user.id, 0.01);
  assert.deepEqual(h.billingService.refundOption(payment), { kind: 'none', reason: 'used' });
});

test('пакет за звёзды: возврат неиспользованного пакета снимает кредиты, подписку не трогает', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const buyer = await h.signup();
  h.billingService.grant(buyer.user.id, 'plus', {
    id: 'crypto:plan-plus',
    method: 'crypto',
    amount: 9,
    currency: 'USD',
  });
  const { payment } = h.billingService.grantPack(buyer.user.id, 'premium-3', {
    id: 'stars:pack-refund',
    method: 'stars',
    amount: 400,
    currency: 'XTR',
    chargeId: 'pack-refund',
    telegramUserId: 777002,
  });
  const result = await h.billingService.requestRefund(buyer.user.id, payment.id);
  assert.equal(result.outcome, 'requested');
  await h.billingService.decideRefund(payment.id, true);
  assert.equal(h.billingService.findPayment(payment.id)?.status, 'refunded');
  assert.equal(h.billingService.ledger.credits.balanceOf(buyer.user.id).remainingUsd, 0);
  assert.equal(h.subscriptionStore.get(buyer.user.id).plan, 'plus');
});

test('бонус за крипту: действует на период, оплаченный через Trybit, и не после возврата', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const buyer = await h.signup();
  const now = Date.now();
  // Сначала оплата звёздами: бонуса нет.
  h.billingService.grant(
    buyer.user.id,
    'pro',
    { id: 'stars:bonus-1', method: 'stars', amount: 1350, currency: 'XTR' },
    now - 40 * DAY_MS,
  );
  assert.equal(h.billingService.cryptoBonusActive(buyer.user.id, 'pro', now - 20 * DAY_MS), false);
  // Продление криптой: бонус — на добавленные 30 дней, а не на оставшиеся дни звёзд.
  h.billingService.grant(
    buyer.user.id,
    'pro',
    { id: 'crypto:bonus-2', method: 'crypto', amount: 25, currency: 'USD' },
    now - 35 * DAY_MS,
  );
  assert.equal(h.billingService.cryptoBonusActive(buyer.user.id, 'pro', now - 20 * DAY_MS), false);
  assert.equal(h.billingService.cryptoBonusActive(buyer.user.id, 'pro', now - 5 * DAY_MS), true);
  assert.equal(h.billingService.cryptoBonusActive(buyer.user.id, 'ultra', now - 5 * DAY_MS), false);
  // Срок истёк — бонуса нет.
  assert.equal(h.billingService.cryptoBonusActive(buyer.user.id, 'pro', now + 30 * DAY_MS), false);
  // Возвращённая оплата бонуса не даёт.
  const crypto = h.billingService.findPayment('crypto:bonus-2')!;
  h.billingService.ledger.payments.put({ ...crypto, status: 'refunded' });
  assert.equal(h.billingService.cryptoBonusActive(buyer.user.id, 'pro', now - 5 * DAY_MS), false);
});

test('оплата с сайта: ссылка ведёт в бота, бот присылает сообщение и счёт', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const buyer = await h.signup();
  const invoice = h.bot.createStarsInvoice(buyer.user.id, 'plus');
  assert.match(invoice.botDeepLink, new RegExp(`\\?start=${invoice.id}$`));

  await h.message(7951, `/start ${invoice.id}`);
  const texts = h.bot
    .all('sendMessage')
    .filter((call) => call.body.chat_id === 7951)
    .map((call) => String(call.body.text));
  assert.equal(texts.length, 1);
  assert.match(texts[0]!, /Счёт на оплату/);
  assert.match(texts[0]!, new RegExp(`Plus · 30 дней — <b>${invoice.starsAmount} ⭐</b>`));
  const sent = h.bot.last('sendInvoice')!;
  assert.equal(sent.body.chat_id, 7951);
  assert.equal(sent.body.currency, 'XTR');
  // Сообщение приходит раньше счёта.
  const order = h.bot.calls.filter((call) => call.body.chat_id === 7951).map((call) => call.method);
  assert.deepEqual(order, ['sendMessage', 'sendInvoice']);
});

test('админ: /clearpayments @username очищает историю оплат, тариф не трогает', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const admin = await h.linkedBuyer(7801);
  h.userStore.setAdmin(admin.buyer.user.id, true);
  const { buyer } = await h.linkedBuyer(7802);
  h.userStore.linkTelegram(buyer.user.id, 7802, 'DjksKejd');
  for (const id of ['stars:x-1', 'stars:x-2']) {
    h.billingService.grant(buyer.user.id, 'pro', {
      id,
      method: 'stars',
      amount: 100,
      currency: 'XTR',
    });
  }
  assert.equal(h.billingService.paymentsOf(buyer.user.id).length, 2);

  // Не администратор не может.
  await h.message(7802, '/clearpayments @djkskejd');
  assert.equal(h.billingService.paymentsOf(buyer.user.id).length, 2);

  await h.message(7801, '/clearpayments @djkskejd');
  assert.equal(h.billingService.paymentsOf(buyer.user.id).length, 0);
  assert.equal(h.subscriptionStore.get(buyer.user.id).plan, 'pro');
  const reply = h.bot
    .all('sendMessage')
    .filter((call) => call.body.chat_id === 7801)
    .at(-1)!;
  assert.match(String(reply.body.text), /удалено записей — 2/);
});

test('админ: /resetplan @username обнуляет тариф только после подтверждения', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const admin = await h.linkedBuyer(7901);
  h.userStore.setAdmin(admin.buyer.user.id, true);
  const { buyer } = await h.linkedBuyer(7902);
  h.userStore.linkTelegram(buyer.user.id, 7902, 'resetme');
  h.billingService.grant(buyer.user.id, 'pro', {
    id: 'stars:r-1',
    method: 'stars',
    amount: 100,
    currency: 'XTR',
  });

  // Не администратор не может.
  await h.message(7902, '/resetplan @resetme');
  assert.equal(h.subscriptionStore.get(buyer.user.id).plan, 'pro');

  await h.message(7901, '/resetplan @resetme');
  const ask = h.bot
    .all('sendMessage')
    .filter((call) => call.body.chat_id === 7901)
    .at(-1)!;
  assert.match(String(ask.body.text), /Обнулить тариф @resetme/);
  assert.equal(h.subscriptionStore.get(buyer.user.id).plan, 'pro', 'без подтверждения не меняется');
  const [yes, no] = (
    ask.body.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> }
  ).inline_keyboard[0]!;

  await h.callback(7901, no!.callback_data);
  assert.equal(h.subscriptionStore.get(buyer.user.id).plan, 'pro');

  // Чужая кнопка не сработает.
  await h.callback(7902, yes!.callback_data);
  assert.equal(h.subscriptionStore.get(buyer.user.id).plan, 'pro');

  await h.callback(7901, yes!.callback_data);
  const sub = h.subscriptionStore.get(buyer.user.id);
  assert.equal(sub.plan, 'free');
  assert.equal(sub.renewsAt, null);
  assert.equal(h.billingService.paymentsOf(buyer.user.id).length, 1, 'история оплат не тронута');
  assert.match(String(h.bot.last('editMessageText')?.body.text), /обнулён/);
});

test('бесплатный Pro (TEMP): в истории как обычная оплата звёздами, возврат без Telegram', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const { buyer, token } = await h.linkedBuyer(8001);
  const user = h.userStore.findById(buyer.user.id)!;
  const invoice = await h.bot.grantFreePlan(user, 'pro');

  const state = await h.mini<MiniState>('state', undefined, token);
  assert.equal(state.body.subscription.plan, 'pro');
  const [payment] = state.body.payments;
  assert.ok(payment);
  assert.equal(payment.amount, invoice.starsAmount);
  assert.ok(invoice.starsAmount > 0);
  assert.equal(payment.status, 'paid');
  assert.match(String((payment as unknown as { chargeId: string }).chargeId), /^stx/);
  assert.equal('free' in payment, false, 'клиенту пометка не видна');
  assert.equal(h.invoiceStore.getTelegramStarsInvoice(invoice.id)?.status, 'paid');
  const receipt = h.bot
    .all('sendMessage')
    .filter((call) => call.body.chat_id === 8001)
    .at(-1)!;
  assert.match(String(receipt.body.text), /Оплата прошла/);

  const refund = await h.mini<{ outcome: string }>(
    `payments/${encodeURIComponent(payment.id)}/refund`,
    { reason: 'Тест' },
    token,
  );
  assert.equal(refund.body.outcome, 'requested');
  await h.billingService.decideRefund(payment.id, true);
  assert.equal(h.bot.all('refundStarPayment').length, 0, 'Telegram не вызывается');
  assert.equal(h.subscriptionStore.get(buyer.user.id).plan, 'free');
});

test('удалить чек из истории может только администратор', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const { buyer, token } = await h.linkedBuyer(8101);
  h.billingService.grant(buyer.user.id, 'pro', {
    id: 'stars:d-1',
    method: 'stars',
    amount: 100,
    currency: 'XTR',
  });
  const path = `payments/${encodeURIComponent('stars:d-1')}`;
  const denied = await h.mini(path, undefined, token, 'DELETE');
  assert.equal(denied.status, 403);
  assert.equal(h.billingService.paymentsOf(buyer.user.id).length, 1);

  h.userStore.setAdmin(buyer.user.id, true);
  const deleted = await h.mini<MiniState>(path, undefined, token, 'DELETE');
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.payments.length, 0);
  assert.equal(h.subscriptionStore.get(buyer.user.id).plan, 'pro', 'тариф не меняется');
  const missing = await h.mini(path, undefined, token, 'DELETE');
  assert.equal(missing.status, 404);
});

/** Бот поддержки с закреплённым чатом администратора; отправленное складывается в массивы. */
function recordingSupportBot(adminChatId: number) {
  const store = createSupportStore(join(mkdtempSync(join(tmpdir(), 'ketner-sup-')), 's.json'));
  const bot = new TelegramSupportBotService({ supportStore: store, botToken: '', adminChatId });
  const sent: Array<{ chatId: number | string; text: string; extra: Record<string, unknown> }> = [];
  const edits: string[] = [];
  bot.sendMessage = async (chatId, text, extra = {}) => {
    sent.push({ chatId, text, extra });
    return { message_id: 5000 + sent.length };
  };
  bot.answerCallbackQuery = async () => true;
  bot.editMessageText = async (_chat, _id, text) => {
    edits.push(text);
    return true;
  };
  return { bot, store, sent, edits };
}

const supportMessage = (
  chatId: number,
  text: string,
  replyTo?: { message_id: number; text?: string },
): TelegramUpdate => ({
  update_id: Date.now(),
  message: {
    message_id: 77,
    date: 0,
    chat: { id: chatId, type: 'private' },
    from: { id: chatId, first_name: 'Admin', username: 'boss' },
    text,
    ...(replyTo ? { reply_to_message: replyTo } : {}),
  },
});

test('возврат: заявка приходит в бот поддержки, ответ Reply доходит клиенту, решение кнопкой', async (t) => {
  const support = recordingSupportBot(9900);
  const h = await harness({ supportBotService: support.bot, supportStore: support.store });
  t.after(() => h.server.close());
  const { buyer, token } = await h.linkedBuyer(9901);
  h.billingService.grant(buyer.user.id, 'pro', {
    id: 'crypto:sup-1',
    method: 'crypto',
    amount: 25,
    currency: 'USD',
  });
  const requested = await h.mini<{ outcome: string }>(
    `payments/${encodeURIComponent('crypto:sup-1')}/refund`,
    { reason: 'Не подошло', comment: 'Медленно отвечает' },
    token,
  );
  assert.equal(requested.body.outcome, 'requested');

  // Заявка — в чат поддержки администратора, с кнопками; в бот оплаты админам не дублируется.
  const notice = support.sent.find((m) => m.chatId === 9900 && /Заявка на возврат/.test(m.text))!;
  assert.ok(notice, 'заявка пришла в бот поддержки');
  assert.match(notice.text, /Медленно отвечает/);
  const ref = /R-([A-Za-z0-9_-]{16})/.exec(notice.text)![1]!;
  const keyboard = (
    notice.extra.reply_markup as {
      inline_keyboard: Array<Array<{ callback_data: string }>>;
    }
  ).inline_keyboard[0]!;
  assert.equal(keyboard[0]!.callback_data, `rf:y:${ref}`);

  // Клиент пишет из кабинета — сообщение в заявке и в чате поддержки.
  const fromUser = await h.mini<
    MiniState & { payments: Array<{ refund: { messages?: unknown[] } }> }
  >(
    `payments/${encodeURIComponent('crypto:sup-1')}/refund/message`,
    { text: 'Когда вернёте?' },
    token,
  );
  assert.equal(fromUser.status, 200);
  assert.equal(fromUser.body.payments[0]!.refund.messages?.length, 1);
  assert.ok(support.sent.some((m) => m.chatId === 9900 && m.text.includes('Когда вернёте?')));

  // Администратор отвечает Reply на заявку — клиенту в бот оплаты и в кабинет.
  const noticeId = 5000 + support.sent.indexOf(notice) + 1;
  await support.bot.processUpdate(
    supportMessage(9900, 'Проверим и вернём сегодня', { message_id: noticeId, text: 'x' }),
  );
  const toClient = h.bot
    .all('sendMessage')
    .filter((call) => call.body.chat_id === 9901)
    .at(-1)!;
  assert.match(String(toClient.body.text), /Поддержка ответила/);
  assert.match(String(toClient.body.text), /Проверим и вернём сегодня/);
  const state = await h.mini<{
    payments: Array<{ refund: { messages: Array<{ from: string }> } }>;
  }>('state', undefined, token);
  assert.deepEqual(
    state.body.payments[0]!.refund.messages.map((m) => m.from),
    ['user', 'admin'],
  );

  // Reply после перезапуска (связь сообщения потеряна) — номер заявки берётся из текста.
  await support.bot.processUpdate(
    supportMessage(9900, 'Ещё уточнение', { message_id: 1, text: `Заявка · R-${ref}` }),
  );
  assert.ok(
    h.bot.all('sendMessage').some((call) => String(call.body.text).includes('Ещё уточнение')),
  );

  // Посторонний нажать кнопку не может.
  await support.bot.processUpdate({
    update_id: 1,
    callback_query: {
      id: 'x',
      from: { id: 1234, first_name: 'Чужой' },
      message: { message_id: noticeId, chat: { id: 1234 } },
      data: `rf:y:${ref}`,
    },
  });
  assert.equal(h.billingService.findPayment('crypto:sup-1')?.status, 'refund_requested');

  await support.bot.processUpdate({
    update_id: 2,
    callback_query: {
      id: 'y',
      from: { id: 9900, first_name: 'Admin' },
      message: { message_id: noticeId, chat: { id: 9900 }, text: 'Заявка' },
      data: `rf:y:${ref}`,
    },
  });
  assert.equal(h.billingService.findPayment('crypto:sup-1')?.status, 'refunded');
  assert.match(support.edits.at(-1)!, /Возврат оформлен/);

  // /refunds — открытых заявок больше нет.
  await support.bot.processUpdate(supportMessage(9900, '/refunds'));
  assert.match(support.sent.at(-1)!.text, /Открытых заявок на возврат нет/);
});

test('возврат звёзд: заявка с кнопками в бот поддержки, звёзды — только после «Одобрить»', async (t) => {
  const support = recordingSupportBot(9910);
  const h = await harness({ supportBotService: support.bot, supportStore: support.store });
  t.after(() => h.server.close());
  const { buyer, token } = await h.linkedBuyer(9911);
  h.billingService.grant(buyer.user.id, 'pro', {
    id: 'stars:auto-1',
    method: 'stars',
    amount: 1260,
    currency: 'XTR',
    chargeId: 'auto-1',
    telegramUserId: 9911,
  });
  const result = await h.mini<{ outcome: string }>(
    `payments/${encodeURIComponent('stars:auto-1')}/refund`,
    { reason: 'Не подошло' },
    token,
  );
  assert.equal(result.body.outcome, 'requested');
  assert.equal(h.bot.all('refundStarPayment').length, 0);
  const notice = support.sent.find((m) => m.chatId === 9910 && /Заявка на возврат/.test(m.text))!;
  assert.ok(notice);
  const ref = /R-([A-Za-z0-9_-]{16})/.exec(notice.text)![1]!;
  await support.bot.processUpdate({
    update_id: 3,
    callback_query: {
      id: 'z',
      from: { id: 9910, first_name: 'Admin' },
      message: { message_id: 5001, chat: { id: 9910 }, text: 'Заявка' },
      data: `rf:y:${ref}`,
    },
  });
  assert.deepEqual(h.bot.last('refundStarPayment')!.body, {
    user_id: 9911,
    telegram_payment_charge_id: 'auto-1',
  });
  assert.equal(h.billingService.findPayment('stars:auto-1')?.status, 'refunded');
});

test('сообщение по возврату: только своя заявка и только при наличии заявки', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const a = await h.linkedBuyer(9921);
  const b = await h.linkedBuyer(9922);
  h.billingService.grant(a.buyer.user.id, 'pro', {
    id: 'crypto:own-1',
    method: 'crypto',
    amount: 25,
    currency: 'USD',
  });
  const path = `payments/${encodeURIComponent('crypto:own-1')}/refund/message`;
  const noRefund = await h.mini(path, { text: 'Привет' }, a.token);
  assert.equal(noRefund.status, 404);
  await h.mini(`payments/${encodeURIComponent('crypto:own-1')}/refund`, { reason: 'x' }, a.token);
  const stranger = await h.mini(path, { text: 'Привет' }, b.token);
  assert.equal(stranger.status, 404);
  const empty = await h.mini(path, { text: '   ' }, a.token);
  assert.equal(empty.status, 400);
});

test('бот поддержки: уведомления администратору сайта без SUPPORT_ADMIN_CHAT_ID (переживают деплой)', async (t) => {
  const store = createSupportStore(join(mkdtempSync(join(tmpdir(), 'ketner-sup-')), 's.json'));
  const sent: Array<{ chatId: number | string; text: string }> = [];
  const userStoreRef: { current?: { list(): User[] } } = {};
  const support = new TelegramSupportBotService({
    supportStore: store,
    botToken: '',
    userStore: { list: () => userStoreRef.current!.list() },
  });
  support.sendMessage = async (chatId, text) => {
    sent.push({ chatId, text });
    return { message_id: 7000 + sent.length };
  };
  const h = await harness({ supportBotService: support, supportStore: store });
  userStoreRef.current = h.userStore;
  t.after(() => h.server.close());
  const admin = await h.linkedBuyer(9931);
  h.userStore.setAdmin(admin.buyer.user.id, true);
  assert.equal(store.getAdminChatId(), undefined, 'чат поддержки после «деплоя» пуст');

  // Обращение в поддержку приходит администратору сайта.
  await support.processUpdate(supportMessage(5551, 'Не работает вход'));
  assert.ok(sent.some((m) => m.chatId === 9931 && /Новое сообщение в поддержку/.test(m.text)));

  // Новая оплата — тоже.
  const { buyer } = await h.linkedBuyer(9932);
  h.billingService.grant(buyer.user.id, 'plus', {
    id: 'stars:n-1',
    method: 'stars',
    amount: 460,
    currency: 'XTR',
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const paid = sent.find((m) => m.chatId === 9931 && /Новая оплата/.test(m.text));
  assert.ok(paid, 'уведомление об оплате');
  assert.match(paid.text, /Plus · 460 ⭐/);

  // Бесплатный Pro помечен отдельно.
  await h.bot.grantFreePlan(h.userStore.findById(buyer.user.id)!, 'pro');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(sent.some((m) => m.chatId === 9931 && /бесплатный тариф/.test(m.text)));

  // Администратор сайта в боте поддержки — оператор, а не клиент.
  const result = await support.processUpdate(supportMessage(9931, '/refunds'));
  assert.equal(result.action, 'admin_refunds_list_sent');
});
