import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultConfig } from '../builder/service.js';
import type { Solution } from '../builder/types.js';
import { getDiscoveryStores } from '../discovery/runtime.js';
import type { MailMessage, Mailer } from '../services/mailer.js';
import { telegramBotService, type TelegramBotService } from '../telegram/bot.js';
import { readJson, startTestServer, type TestServer } from '../testing/server.js';
import { signupAndVerify } from '../testing/signup.js';
import type { AuthSession } from '../types.js';

/**
 * Шаг «заявка → менеджер» по тому же пути, что в production: BotService собирает routes/solutions.ts
 * (письмо — ownerMailer, Telegram — бот Ketner сервера), заявка приходит на публичный адрес бота.
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
  }) as TelegramBotService;
  return { value, sent };
}

async function setup(t: test.TestContext, linked = true) {
  const mails: MailMessage[] = [];
  const mailer: Mailer = {
    kind: 'smtp',
    async send(message) {
      mails.push(message);
    },
  };
  const telegram = fakeTelegram(linked);
  const logs: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => logs.push(args.map(String).join(' '));
  const server = await startTestServer({}, { mailer, botService: telegram.value });
  t.after(async () => {
    console.warn = originalWarn;
    await server.close();
  });
  return { server, mails, telegram, logs };
}

async function signupOwner(server: TestServer): Promise<AuthSession & { email: string }> {
  const email = `lead-owner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const session = await readJson<AuthSession>(
    await signupAndVerify(server.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123', name: 'Owner' }),
    }),
  );
  return { ...session, email };
}

/** Опубликованный бот владельца; `leadNotify` — как сохранено у бота (нет — бот до шага). */
async function publishedBot(
  owner: AuthSession,
  slug: string,
  leadNotify?: { email: boolean; telegram: boolean },
) {
  const now = new Date().toISOString();
  const id = `bot-${slug}`;
  await getDiscoveryStores()!.builder.createSolution(
    {
      id,
      ownerId: owner.user.id,
      type: 'customer_bot',
      template: 'customer_bot',
      bot: {
        slug,
        greeting: 'Здравствуйте!',
        quickReplies: [],
        dailyCapCredits: 1000,
        corrections: [],
        ...(leadNotify ? { leadNotify } : {}),
      },
      status: 'active',
      name: 'Лиса',
      currentVersion: 1,
      activeVersion: 1,
      source: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    } as Solution,
    { solutionId: id, number: 1, config: defaultConfig('Лиса', 'ru'), createdAt: now },
    [],
  );
  return id;
}

async function leaveLead(server: TestServer, slug: string) {
  const response = await fetch(`${server.baseUrl}/api/b/${slug}/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      visitorId: 'v_leadnotifyvisitor1',
      name: 'Анна <b>',
      contact: '+7 700 000 00 00',
      question: 'Букет на завтра',
    }),
  });
  assert.equal(response.status, 201);
}

/** Уведомления идут в фоне после ответа посетителю: ждём их (не дольше 2 с). */
async function until(check: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('уведомление не пришло за 2 с');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const lines = (logs: string[]) =>
  logs.filter((line) => line.includes('[bot] уведомление о заявке'));

test('новый бот (оба канала): письмо и Telegram владельцу, по строке в логе на канал', async (t) => {
  const { server, mails, telegram, logs } = await setup(t);
  const owner = await signupOwner(server);
  const id = await publishedBot(owner, 'lisa-notify-a', { email: true, telegram: true });
  await leaveLead(server, 'lisa-notify-a');
  await until(() => lines(logs).length === 2);

  const mail = mails.find((message) => message.subject.startsWith('Новая заявка'));
  assert.equal(mail?.to, owner.email);
  assert.equal(telegram.sent.length, 1);
  assert.equal(telegram.sent[0]!.userId, owner.user.id);
  assert.match(telegram.sent[0]!.text, /Имя: Анна &#60;b&#62;/);
  assert.match(telegram.sent[0]!.text, new RegExp(`/solutions/${id}$`));
  assert.equal(lines(logs).length, 2);
  assert.ok(lines(logs).every((line) => line.endsWith('— отправлено')));
  assert.ok(!logs.join('\n').includes(owner.email) && !logs.join('\n').includes('+7 700'));
});

test('бот до шага: письмо как раньше, Telegram не приходит', async (t) => {
  const { server, mails, telegram, logs } = await setup(t);
  const owner = await signupOwner(server);
  await publishedBot(owner, 'lisa-notify-b');
  await leaveLead(server, 'lisa-notify-b');
  await until(() => lines(logs).length === 2);
  assert.equal(mails.filter((message) => message.subject.startsWith('Новая заявка')).length, 1);
  assert.equal(telegram.sent.length, 0);
});

test('кабинет: переключатели сохраняются и действуют; Telegram не привязан — видно в обзоре', async (t) => {
  const { server, mails, telegram, logs } = await setup(t, false);
  const owner = await signupOwner(server);
  const id = await publishedBot(owner, 'lisa-notify-c');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` };

  type Overview = {
    settings: { leadNotify: { email: boolean; telegram: boolean } };
    leadNotify: { telegramLinked: boolean };
  };
  const before = await readJson<Overview>(
    await fetch(`${server.baseUrl}/api/solutions/${id}/bot`, { headers }),
  );
  assert.deepEqual(before.settings.leadNotify, { email: true, telegram: false });
  assert.deepEqual(before.leadNotify, { telegramLinked: false });

  const saved = await fetch(`${server.baseUrl}/api/solutions/${id}/bot`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ leadNotify: { email: false, telegram: true } }),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual((await readJson<Overview>(saved)).settings.leadNotify, {
    email: false,
    telegram: true,
  });
  // Лишние поля и не-boolean — отказ.
  const bad = await fetch(`${server.baseUrl}/api/solutions/${id}/bot`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ leadNotify: { email: 'yes', telegram: true } }),
  });
  assert.equal(bad.status, 400);

  await leaveLead(server, 'lisa-notify-c');
  await until(() => lines(logs).length === 2);
  assert.equal(mails.filter((message) => message.subject.startsWith('Новая заявка')).length, 0);
  // Telegram включён, но не привязан — не отправлено (причина в логе), заявка сохранена.
  assert.equal(telegram.sent.length, 0);
});

test('каталог автоматизаций: обзор, переключатели, перенос leadNotify, недоступный шаблон', async (t) => {
  const { server, mails, telegram, logs } = await setup(t);
  const owner = await signupOwner(server);
  const id = await publishedBot(owner, 'lisa-notify-d', { email: true, telegram: true });
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` };
  const url = `${server.baseUrl}/api/solutions/${id}/bot`;

  type Overview = {
    settings: Record<string, unknown> & { leadNotify: { email: boolean; telegram: boolean } };
    automations: Array<{ id: string; enabled: boolean; available: boolean; risk: string }>;
  };
  const before = await readJson<Overview>(await fetch(url, { headers }));
  assert.deepEqual(
    before.automations.map((item) => [item.id, item.enabled, item.available, item.risk]),
    [
      ['lead_to_sheet', true, true, 'low'],
      ['lead_to_manager', true, true, 'low'],
      ['daily_lead_summary', false, false, 'low'],
    ],
  );
  assert.ok(!('automations' in before.settings), 'форма настроек не получает переключатели');

  // Сохранение любой настройки переносит leadNotify в automations.
  const greeting = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ greeting: 'Добрый день!' }),
  });
  assert.equal(greeting.status, 200, await greeting.clone().text());
  const stored = await getDiscoveryStores()!.builder.getSolution(owner.user.id, id);
  assert.equal(stored?.bot?.leadNotify, undefined);
  assert.deepEqual(stored?.bot?.automations?.lead_to_manager, {
    enabled: true,
    version: 1,
    options: { email: true, telegram: true },
  });

  // Сводка за день: нужен планировщик — отказ с причиной.
  const summary = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ automations: { daily_lead_summary: { enabled: true } } }),
  });
  assert.equal(summary.status, 409);
  assert.match(JSON.stringify(await summary.json()), /automation_unavailable/);

  // Неизвестный шаблон — 400.
  const unknown = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ automations: { lead_to_crm: { enabled: true } } }),
  });
  assert.equal(unknown.status, 400);

  // Выключить «заявка → менеджер»: уведомлений нет, заявка сохраняется.
  const off = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ automations: { lead_to_manager: { enabled: false } } }),
  });
  assert.equal(off.status, 200, await off.clone().text());
  assert.deepEqual((await readJson<Overview>(off)).settings.leadNotify, {
    email: false,
    telegram: false,
  });
  await leaveLead(server, 'lisa-notify-d');
  await until(() => lines(logs).length === 2);
  assert.ok(lines(logs).every((line) => line.endsWith('— выключено в настройках бота')));
  assert.equal(mails.filter((message) => message.subject.startsWith('Новая заявка')).length, 0);
  assert.equal(telegram.sent.length, 0);
});

test('схема бота: узлы и описание по настройкам, состояние подключений, чужой бот — 404', async (t) => {
  const { server } = await setup(t);
  const owner = await signupOwner(server);
  const id = await publishedBot(owner, 'lisa-notify-e', { email: true, telegram: true });
  const headers = { Authorization: `Bearer ${owner.token}` };
  type DiagramView = {
    nodes: Array<{ id: string; kind: string; state?: string; stateLabel?: string }>;
    edges: Array<{ from: string; to: string }>;
    description: string[];
  };
  const diagram = await readJson<DiagramView>(
    await fetch(`${server.baseUrl}/api/solutions/${id}/bot/diagram`, { headers }),
  );
  assert.deepEqual(
    diagram.nodes.map((node) => node.id),
    [
      'trigger',
      'agent:bot',
      'event:lead.created',
      'step:lead_to_sheet:step-1',
      'service:spreadsheets_sync',
      'step:lead_to_manager:step-1',
    ],
  );
  // Таблица не подключена; почта есть, Telegram привязан (фейк сервера).
  const sheet = diagram.nodes.find((node) => node.id === 'service:spreadsheets_sync')!;
  assert.deepEqual([sheet.state, sheet.stateLabel], ['off', 'не подключена']);
  const manager = diagram.nodes.find((node) => node.id === 'step:lead_to_manager:step-1')!;
  assert.deepEqual([manager.state, manager.stateLabel], ['ok', 'почта, Telegram']);
  assert.equal(diagram.description[0], 'Посетитель пишет боту → Бот «Лиса»');

  // Выключили «заявка → таблица» — узлов таблицы нет.
  await fetch(`${server.baseUrl}/api/solutions/${id}/bot`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ automations: { lead_to_sheet: { enabled: false } } }),
  });
  const after = await readJson<DiagramView>(
    await fetch(`${server.baseUrl}/api/solutions/${id}/bot/diagram`, { headers }),
  );
  assert.ok(!after.nodes.some((node) => node.id.includes('sheet')));

  const stranger = await signupOwner(server);
  const denied = await fetch(`${server.baseUrl}/api/solutions/${id}/bot/diagram`, {
    headers: { Authorization: `Bearer ${stranger.token}` },
  });
  assert.equal(denied.status, 404);
});
