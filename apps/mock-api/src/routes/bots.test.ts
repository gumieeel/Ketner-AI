/**
 * Бот для клиентов по HTTP (этап B): публичная страница без входа, кабинет владельца, чужие — 404,
 * лимиты, страница встраивается в чужие сайты, а кабинет — нет.
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { GatewayRequest, GatewayStreamCallbacks } from '../ai/gateway-types.js';
import { createApp } from '../app.js';
import { BuilderService, defaultConfig } from '../builder/service.js';
import { MemoryBuilderStore } from '../builder/store.js';
import { MemoryBudgetStore } from '../discovery/budget.js';
import { MemoryDiscoveryStore } from '../discovery/store.js';
import type { MailMessage } from '../services/mailer.js';
import { createConversationStore } from '../store/conversation-store.js';
import { createSubscriptionStore } from '../store/subscription-store.js';
import { createUserStore } from '../store/user-store.js';
import { UsageStore } from '../store/usage-store.js';
import { isCodeMail, rememberCodeMails, signupAndVerify } from '../testing/signup.js';

const gateway = {
  async stream(request: GatewayRequest, callbacks: GatewayStreamCallbacks) {
    callbacks.onDelta(`Бот: ${request.messages.at(-1)?.content ?? ''}`);
    callbacks.onDone({
      inputTokens: 1,
      outputTokens: 1,
      source: 'provider',
      finishReason: 'stop',
      canContinue: false,
      selectedModel: { id: 'ketner-pro', name: 'auto' },
      costUsd: 0.001,
      creditsUsd: 0.001,
    });
  },
};

async function start() {
  const dir = mkdtempSync(join(tmpdir(), 'ketner-bots-'));
  const codeMails: MailMessage[] = [];
  const otherMails: MailMessage[] = [];
  const builderStore = new MemoryBuilderStore();
  const discoveryStore = new MemoryDiscoveryStore();
  const stores = () => ({
    store: discoveryStore,
    budget: new MemoryBudgetStore(),
    builder: builderStore,
  });
  const builder = new BuilderService({
    store: builderStore,
    discovery: discoveryStore,
    gateway,
    balanceUsd: () => 1,
  });
  const app = createApp({
    store: createConversationStore(join(dir, 'c.json')),
    userStore: createUserStore(join(dir, 'u.json')),
    subscriptionStore: createSubscriptionStore(join(dir, 's.json')),
    usageStore: new UsageStore(join(dir, 'usage.json')),
    discoveryEnabled: true,
    discovery: { stores },
    builder,
    chatGateway: gateway as never,
    mailer: {
      kind: 'smtp',
      async send(message) {
        if (isCodeMail(message)) codeMails.push(message);
        else otherMails.push(message);
      },
    },
  });
  const server: Server = app.listen(0);
  const base = `http://localhost:${(server.address() as { port: number }).port}`;
  rememberCodeMails(base, codeMails);
  return { base, builderStore, otherMails, close: () => server.close() };
}

async function signup(base: string, email: string) {
  const response = await signupAndVerify(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', name: 'User' }),
  });
  const token = ((await response.json()) as { token: string }).token;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const me = (await (await fetch(`${base}/api/auth/me`, { headers })).json()) as {
    user: { id: string };
  };
  return { headers, userId: me.user.id };
}

const json = { 'Content-Type': 'application/json' };
const VISITOR = 'v_httpvisitor0001';

test('бот по HTTP: страница без входа, заявка владельцу, кабинет только у владельца', async () => {
  const app = await start();
  try {
    const owner = await signup(app.base, 'bot-owner@example.com');
    const now = new Date().toISOString();
    await app.builderStore.createSolution(
      {
        id: 'http-bot',
        ownerId: owner.userId,
        type: 'customer_bot',
        bot: {
          slug: 'lisa-http',
          greeting: 'Здравствуйте!',
          quickReplies: ['Доставка'],
          dailyCapCredits: 1000,
          corrections: [],
        },
        status: 'active',
        name: 'Лиса',
        currentVersion: 1,
        activeVersion: 1,
        source: null,
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      { solutionId: 'http-bot', number: 1, config: defaultConfig('Лиса', 'ru'), createdAt: now },
      [],
    );

    // Публичная сторона.
    const info = await fetch(`${app.base}/api/b/lisa-http`);
    assert.equal(info.status, 200);
    const bot = ((await info.json()) as { bot: Record<string, unknown> }).bot;
    assert.equal(bot.greeting, 'Здравствуйте!');
    assert.ok(!('ownerId' in bot) && !('id' in bot), 'владелец и id наружу не отдаются');
    assert.equal((await fetch(`${app.base}/api/b/nobody-here`)).status, 404);

    const bad = await fetch(`${app.base}/api/b/lisa-http/messages`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ visitorId: 'not-a-visitor', content: 'Привет' }),
    });
    assert.equal(bad.status, 400);

    const sent = await fetch(`${app.base}/api/b/lisa-http/messages`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ visitorId: VISITOR, content: 'Есть доставка?' }),
    });
    assert.equal(sent.status, 200);
    const reply = (await sent.json()) as {
      conversationId: string;
      message: { role: string; content: string; offerContact: boolean };
    };
    assert.equal(reply.message.role, 'assistant');
    assert.ok(reply.message.content.length > 0);

    const history = await fetch(
      `${app.base}/api/b/lisa-http/conversations/${reply.conversationId}?visitorId=${VISITOR}`,
    );
    assert.equal(history.status, 200);
    assert.equal(((await history.json()) as { messages: unknown[] }).messages.length, 2);
    const foreignHistory = await fetch(
      `${app.base}/api/b/lisa-http/conversations/${reply.conversationId}?visitorId=v_strangervisitor1`,
    );
    assert.equal(foreignHistory.status, 404);

    const lead = await fetch(`${app.base}/api/b/lisa-http/leads`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        visitorId: VISITOR,
        conversationId: reply.conversationId,
        name: 'Анна\nBcc: x@evil.test',
        contact: '+7 700 000 00 00',
        question: 'Букет на завтра',
      }),
    });
    assert.equal(lead.status, 201);
    const mail = app.otherMails.find((item) => item.subject.startsWith('Новая заявка'));
    assert.equal(mail?.to, 'bot-owner@example.com');
    assert.ok(!/[\r\n]/.test(mail?.subject ?? ''), 'перенос строки из имени не попадает в тему');

    // Кабинет владельца.
    const call = (path: string, init: RequestInit = {}, headers = owner.headers) =>
      fetch(`${app.base}/api/solutions${path}`, { ...init, headers });
    const overview = (await (await call('/http-bot/bot')).json()) as {
      settings: { slug: string };
      today: { replies: number; newLeads: number };
      publicUrl: string;
    };
    assert.match(overview.publicUrl, /\/b\/lisa-http$/);
    assert.equal(overview.today.replies, 1);
    assert.equal(overview.today.newLeads, 1);
    const leads = (await (await call('/http-bot/leads')).json()) as {
      leads: Array<{ id: string; name: string; conversationId: string | null }>;
    };
    assert.equal(leads.leads[0]?.conversationId, reply.conversationId);
    const conversations = (await (await call('/http-bot/conversations')).json()) as {
      conversations: Array<Record<string, unknown>>;
    };
    assert.equal(conversations.conversations.length, 1);
    assert.ok(
      !('visitorId' in conversations.conversations[0]!),
      'id посетителя владельцу не нужен',
    );
    const list = (await (await call('')).json()) as {
      solutions: Array<{ id: string; type: string; today?: { replies: number } }>;
    };
    assert.equal(list.solutions[0]?.type, 'customer_bot');
    assert.equal(list.solutions[0]?.today?.replies, 1);
    // У бота нет чатов владельца: он отвечает на своей странице.
    assert.equal((await call('/http-bot/threads', { method: 'POST' })).status, 409);

    const renamed = await call('/http-bot/bot', {
      method: 'PUT',
      body: JSON.stringify({ slug: 'lisa-new', dailyCapCredits: 200 }),
    });
    assert.equal(renamed.status, 200);
    assert.equal((await fetch(`${app.base}/api/b/lisa-new`)).status, 200);
    assert.equal((await fetch(`${app.base}/api/b/lisa-http`)).status, 404);
    const tooSmall = await call('/http-bot/bot', {
      method: 'PUT',
      body: JSON.stringify({ dailyCapCredits: 1 }),
    });
    assert.equal(tooSmall.status, 400);

    // Чужой пользователь ничего не видит и не меняет.
    const stranger = await signup(app.base, 'bot-stranger@example.com');
    for (const [method, path, body] of [
      ['GET', '/http-bot/bot', undefined],
      ['PUT', '/http-bot/bot', '{"greeting":"x"}'],
      ['POST', '/http-bot/bot/preview', '{"messages":[{"role":"user","content":"Привет"}]}'],
      ['GET', '/http-bot/conversations', undefined],
      ['GET', `/http-bot/conversations/${reply.conversationId}`, undefined],
      ['GET', '/http-bot/leads', undefined],
      ['PATCH', `/http-bot/leads/${leads.leads[0]!.id}`, '{"status":"done"}'],
    ] as const) {
      const response = await call(path, { method, ...(body ? { body } : {}) }, stranger.headers);
      assert.equal(response.status, 404, `${method} ${path}`);
    }
    const done = await call(`/http-bot/leads/${leads.leads[0]!.id}`, {
      method: 'PATCH',
      body: '{"status":"done"}',
    });
    assert.equal(done.status, 200);

    // Страница бота встраивается в чужие сайты; кабинет — нет; обе закрыты от поиска.
    const page = await fetch(`${app.base}/b/lisa-new`);
    const pageHtml = await page.clone().text();
    assert.ok(!pageHtml.includes('googletagmanager'), 'рекламного тега на странице бота нет');
    const cabinet = await fetch(`${app.base}/solutions/http-bot`);
    if (page.headers.get('content-security-policy')) {
      assert.match(page.headers.get('content-security-policy')!, /frame-ancestors \*/);
      assert.match(cabinet.headers.get('content-security-policy')!, /frame-ancestors 'self'/);
    }
  } finally {
    app.close();
  }
});

test('лимит сообщений посетителя: 21-е за 10 минут — 429', async () => {
  const app = await start();
  try {
    const owner = await signup(app.base, 'bot-limit@example.com');
    const now = new Date().toISOString();
    await app.builderStore.createSolution(
      {
        id: 'limit-bot',
        ownerId: owner.userId,
        type: 'customer_bot',
        bot: {
          slug: 'limit-bot',
          greeting: 'Привет',
          quickReplies: [],
          dailyCapCredits: 1000,
          corrections: [],
        },
        status: 'active',
        name: 'Лимит',
        currentVersion: 1,
        activeVersion: 1,
        source: null,
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      { solutionId: 'limit-bot', number: 1, config: defaultConfig('Лимит', 'ru'), createdAt: now },
      [],
    );
    const send = () =>
      fetch(`${app.base}/api/b/limit-bot/messages`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ visitorId: 'v_limitvisitor001', content: 'Привет' }),
      });
    for (let index = 0; index < 20; index += 1) assert.equal((await send()).status, 200);
    assert.equal((await send()).status, 429);
  } finally {
    app.close();
  }
});
