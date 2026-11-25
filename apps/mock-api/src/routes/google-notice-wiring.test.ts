import assert from 'node:assert/strict';
import test from 'node:test';
import { setProductSwitchForTests } from '../product-switches.js';
import type { MailMessage, Mailer } from '../services/mailer.js';
import { telegramBotService, type TelegramBotService } from '../telegram/bot.js';
import { FAKE_GOOGLE_SETTINGS, createFakeGoogle } from '../testing/fake-google.js';
import { readJson, startTestServer, type TestServer } from '../testing/server.js';
import { signupAndVerify } from '../testing/signup.js';
import type { AuthSession } from '../types.js';
import { setTierEnforcedForTests } from '../billing/tier-usage.js';

// Правила тарифа для внешних сервисов — в routes/google-tier.test.ts; здесь — поведение Google.
setTierEnforcedForTests(false);

/**
 * Уведомление владельцу о поломке Google Таблицы — по тому же пути, что в production: доставку
 * собирает routes/index.ts (createSheetsDelivery с ownerMailer, хранилищем пользователей и ботом
 * Telegram), а не тест. Пилот 22.11: после «sheet_missing (trashed)» и «reconnect_required
 * (invalid_grant)» не было ни письма, ни Telegram, ни строки в логе — каналы молча пропускались.
 */

setProductSwitchForTests('googleSheets', true);

function fakeMailer(kind: Mailer['kind'], failWith?: Error) {
  const mails: MailMessage[] = [];
  // Вид почты меняется после регистрации: без почты код подтверждения не дойдёт до теста.
  const state = { kind };
  const value: Mailer = {
    get kind() {
      return state.kind;
    },
    async send(message) {
      if (failWith) throw failWith;
      mails.push(message);
    },
  };
  return { value, mails, state };
}

/**
 * Бот Telegram сервера с подменёнными методами уведомления владельца: остальное (роутер Telegram и
 * т. д.) — настоящий сервис в тестовом режиме, как его получает routes/index.ts.
 */
function fakeTelegram(linked: boolean) {
  const sent: Array<{ userId: string; text: string }> = [];
  const overrides: Record<string, unknown> = {
    canNotifyUser: () => linked,
    notifyOwner: async (userId: string, text: string) => {
      sent.push({ userId, text });
    },
  };
  const value = new Proxy(telegramBotService, {
    get(target, property, receiver) {
      if (typeof property === 'string' && property in overrides) return overrides[property];
      const member = Reflect.get(target, property, receiver) as unknown;
      return typeof member === 'function'
        ? (member as (...args: unknown[]) => unknown).bind(target)
        : member;
    },
  });
  return { value, sent };
}

async function setup(t: test.TestContext, mailer: Mailer, botService: TelegramBotService) {
  const google = createFakeGoogle();
  const logs: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => logs.push(args.map(String).join(' '));
  const server = await startTestServer(
    {},
    {
      googleFetch: google.fetchImpl,
      googleSettings: () => FAKE_GOOGLE_SETTINGS,
      mailer,
      botService,
    },
  );
  t.after(async () => {
    console.warn = originalWarn;
    await server.close();
  });
  return { server, google, logs };
}

async function signupOwner(server: TestServer): Promise<AuthSession & { email: string }> {
  const email = `owner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const session = await readJson<AuthSession>(
    await signupAndVerify(server.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123', name: 'Owner' }),
    }),
  );
  return { ...session, email };
}

function call(server: TestServer, session: AuthSession, path: string, body: unknown = {}) {
  return fetch(`${server.baseUrl}/api/integrations/google${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    body: JSON.stringify(body),
  });
}

async function connect(server: TestServer, session: AuthSession) {
  const { url } = await readJson<{ url: string }>(
    await call(server, session, '/start', { returnTo: 'http://localhost:5173/solutions/s1' }),
  );
  const state = new URL(url).searchParams.get('state')!;
  assert.equal((await call(server, session, '/confirm', { code: 'code-1', state })).status, 200);
}

const noticeLines = (logs: string[]) =>
  logs.filter((line) => line.includes('[sheets] уведомление владельцу'));

test('таблица в корзине: письмо и Telegram владельцу, по строке в логе на канал, без адреса', async (t) => {
  const mail = fakeMailer('smtp');
  const telegram = fakeTelegram(true);
  const { server, google, logs } = await setup(t, mail.value, telegram.value);
  const owner = await signupOwner(server);
  await connect(server, owner);

  google.trashed = true;
  // «Дописать пропущенные» проверяет корзину — поломка обнаружена, уведомление уходит.
  await call(server, owner, '/backfill');

  const notices = mail.mails.filter((message) => message.subject.includes('Google Таблица'));
  assert.equal(notices.length, 1);
  assert.equal(notices[0]!.to, owner.email);
  assert.equal(notices[0]!.subject, 'Google Таблица с заявками удалена');
  assert.equal(telegram.sent.length, 1);
  assert.equal(telegram.sent[0]!.userId, owner.user.id);
  assert.deepEqual(noticeLines(logs), [
    `[sheets] уведомление владельцу ${owner.user.id} (sheet_missing): письмо — отправлено`,
    `[sheets] уведомление владельцу ${owner.user.id} (sheet_missing): Telegram — отправлено`,
  ]);
  assert.ok(!logs.join('\n').includes(owner.email), 'адреса нет в логе');

  // Одна поломка — одно уведомление: повторная проверка ничего не шлёт.
  await call(server, owner, '/backfill');
  assert.equal(telegram.sent.length, 1);
});

test('доступ отозван (invalid_grant): уведомление reconnect_required', async (t) => {
  const mail = fakeMailer('smtp');
  const telegram = fakeTelegram(true);
  const { server, google, logs } = await setup(t, mail.value, telegram.value);
  const owner = await signupOwner(server);
  await connect(server, owner);

  google.refreshError = 'invalid_grant';
  await call(server, owner, '/backfill');
  assert.equal(
    mail.mails.filter((message) => message.subject === 'Заявки не записываются в Google Таблицу')
      .length,
    1,
  );
  assert.equal(telegram.sent.length, 1);
  assert.equal(noticeLines(logs).length, 2);
  assert.ok(noticeLines(logs).every((line) => line.includes('(reconnect_required)')));
});

test('почта не настроена и Telegram не привязан — причина каждого пропуска в логе', async (t) => {
  const mail = fakeMailer('smtp');
  const { server, google, logs } = await setup(t, mail.value, fakeTelegram(false).value);
  const owner = await signupOwner(server);
  await connect(server, owner);
  // Как в production без SMTP_HOST / MAIL_FROM.
  mail.state.kind = 'none';
  google.trashed = true;
  await call(server, owner, '/backfill');
  assert.deepEqual(noticeLines(logs), [
    `[sheets] уведомление владельцу ${owner.user.id} (sheet_missing): письмо — не отправлено: почта на сервере не настроена (SMTP_HOST, MAIL_FROM)`,
    `[sheets] уведомление владельцу ${owner.user.id} (sheet_missing): Telegram — не отправлено: Telegram не привязан к аккаунту или бот не настроен`,
  ]);
});

test('сбой SMTP не мешает Telegram; в логе код ошибки, а не её текст с адресом', async (t) => {
  const failure = Object.assign(new Error('Recipient address rejected: owner@example.com'), {
    code: 'EENVELOPE',
  });
  const telegram = fakeTelegram(true);
  const { server, google, logs } = await setup(
    t,
    fakeMailer('smtp', failure).value,
    telegram.value,
  );
  const owner = await signupOwner(server);
  await connect(server, owner);
  google.trashed = true;
  await call(server, owner, '/backfill');
  assert.deepEqual(noticeLines(logs), [
    `[sheets] уведомление владельцу ${owner.user.id} (sheet_missing): письмо — ошибка отправки (EENVELOPE)`,
    `[sheets] уведомление владельцу ${owner.user.id} (sheet_missing): Telegram — отправлено`,
  ]);
  assert.equal(telegram.sent.length, 1);
  assert.ok(!logs.join('\n').includes('owner@example.com'));
});
