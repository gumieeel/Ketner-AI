import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { GatewayRequest, GatewayStreamCallbacks } from '../ai/gateway-types.js';
import { createApp } from '../app.js';
import { BuilderService, draftTemplate } from '../builder/service.js';
import { MemoryBuilderStore } from '../builder/store.js';
import { MemoryBudgetStore } from '../discovery/budget.js';
import { DiscoveryService } from '../discovery/service.js';
import { MemoryDiscoveryStore } from '../discovery/store.js';
import { contextTemplate, discoveryTemplate } from '../discovery/templates.js';
import type { MailMessage } from '../services/mailer.js';
import { createConversationStore } from '../store/conversation-store.js';
import { createSubscriptionStore } from '../store/subscription-store.js';
import { createUserStore } from '../store/user-store.js';
import { UsageStore } from '../store/usage-store.js';
import { isCodeMail, rememberCodeMails, signupAndVerify } from '../testing/signup.js';

/** Шлюз на демо-шаблонах: этапы анализа, черновик, судья и ответы помощника. */
const templateGateway = {
  async stream(request: GatewayRequest, callbacks: GatewayStreamCallbacks) {
    const id = request.task?.id ?? '';
    const stage = id.split(':')[1];
    const input = request.messages[0]?.content ?? '';
    const text = id.includes(':draft:')
      ? draftTemplate('Черновики ответов', 'ru')
      : id.includes(':judge:')
        ? JSON.stringify({ criteria: [{ criterion: 'c', met: true, note: '' }], notes: '' })
        : request.assistant
          ? `Помощник отвечает: ${request.messages.at(-1)?.content}`
          : stage === 'context'
            ? contextTemplate(input, 'ru')
            : discoveryTemplate('ru');
    callbacks.onDelta(text);
    callbacks.onDone({
      inputTokens: 1,
      outputTokens: 1,
      source: 'provider',
      finishReason: 'stop',
      canContinue: false,
      selectedModel: {
        id: request.assistant ? 'ketner-pro' : request.modelId,
        name: request.modelId,
      },
      costUsd: 0.001,
      // Как в шлюзе: бесплатный (sponsored) вызов кредиты не списывает.
      creditsUsd: request.task?.billing === 'sponsored' ? 0 : 0.001,
    });
  },
};

async function start() {
  const dir = mkdtempSync(join(tmpdir(), 'ketner-solutions-'));
  const mails: MailMessage[] = [];
  const store = new MemoryDiscoveryStore();
  const budget = new MemoryBudgetStore();
  const builderStore = new MemoryBuilderStore();
  const stores = () => ({ store, budget, builder: builderStore });
  const discovery = new DiscoveryService({
    store,
    budget,
    gateway: templateGateway,
    balanceUsd: () => 0,
    userCapabilities: () => ({ hasPurchasedCredits: false, githubConnected: false }),
    freeDailyUsd: 5,
    budgetTimeZone: 'UTC',
  });
  const builder = new BuilderService({
    store: builderStore,
    discovery: store,
    gateway: templateGateway,
    balanceUsd: () => 1,
  });
  const app = createApp({
    store: createConversationStore(join(dir, 'c.json')),
    userStore: createUserStore(join(dir, 'u.json')),
    subscriptionStore: createSubscriptionStore(join(dir, 's.json')),
    usageStore: new UsageStore(join(dir, 'usage.json')),
    discoveryEnabled: true,
    discovery: { service: discovery, stores },
    builder,
    mailer: {
      kind: 'smtp',
      async send(message) {
        if (isCodeMail(message)) mails.push(message);
      },
    },
  });
  const server: Server = app.listen(0);
  const base = `http://localhost:${(server.address() as { port: number }).port}`;
  rememberCodeMails(base, mails);
  return { base, discovery, builder, close: () => server.close() };
}

async function signup(base: string, email: string): Promise<string> {
  const response = await signupAndVerify(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', name: 'User' }),
  });
  return ((await response.json()) as { token: string }).token;
}

test('Builder по HTTP: только после входа; помощник из возможности, тесты, включение, чат; чужой — 404', async () => {
  const app = await start();
  try {
    const anonymous = await fetch(`${app.base}/api/solutions`);
    assert.equal(anonymous.status, 401);

    const token = await signup(app.base, 'builder-owner@example.com');
    const auth = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Guest-Id': 'guest_builderown',
    };
    const call = (path: string, init: RequestInit = {}) =>
      fetch(`${app.base}/api/solutions${path}`, { ...init, headers: auth });

    // Анализ этого пользователя с готовым отчётом.
    const created = await fetch(`${app.base}/api/analyses`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        text: 'Веду интернет-магазин, отвечаю покупателям на однотипные вопросы.',
      }),
    });
    const analysisId = ((await created.json()) as { analysis: { id: string } }).analysis.id;
    await app.discovery.whenIdle();
    await fetch(`${app.base}/api/analyses/${analysisId}/continue`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ answers: { q1: { value: 'В таблицах' } } }),
    });
    await app.discovery.whenIdle();
    const report = (await (
      await fetch(`${app.base}/api/analyses/${analysisId}`, { headers: auth })
    ).json()) as { analysis: { opportunities: Array<{ id: string; feasibilityStatus: string }> } };
    const opportunity = report.analysis.opportunities.find(
      (item) => item.feasibilityStatus === 'ready',
    )!;

    // Новый бесплатный пользователь проходит полный анализ и получает краткий план без кредитов.
    const free = (await (
      await fetch(`${app.base}/api/analyses/${analysisId}`, { headers: auth })
    ).json()) as {
      analysis: { status: string; cost: { chargedCredits: number; sponsored: boolean } };
    };
    assert.equal(free.analysis.status, 'ready');
    assert.deepEqual(free.analysis.cost, { chargedCredits: 0, sponsored: true });
    const brief = await fetch(
      `${app.base}/api/analyses/${analysisId}/opportunities/${opportunity.id}/plan`,
      { method: 'POST', headers: auth, body: '{}' },
    );
    assert.equal(brief.status, 202);
    const briefPlan = (await brief.json()) as {
      plan: { kind: string; cost: { sponsored: boolean } };
    };
    assert.equal(briefPlan.plan.kind, 'brief');
    assert.equal(briefPlan.plan.cost.sponsored, true);
    await app.discovery.whenIdle();

    const quote = (await (await call('/draft-quote')).json()) as { model: string };
    assert.equal(quote.model, 'MiMo-V2.6 Pro');
    const unconfirmed = await call('/from-opportunity', {
      method: 'POST',
      body: JSON.stringify({ analysisId, opportunityId: opportunity.id }),
    });
    assert.equal(unconfirmed.status, 409);
    const draft = await call('/from-opportunity', {
      method: 'POST',
      body: JSON.stringify({ analysisId, opportunityId: opportunity.id, confirm: true }),
    });
    assert.equal(draft.status, 201);
    const id = ((await draft.json()) as { solution: { id: string } }).solution.id;

    const view = (await (await call(`/${id}`)).json()) as {
      solution: Record<string, unknown>;
      cases: unknown[];
      readiness: { ready: boolean };
      testQuote: { maxCredits: number };
    };
    assert.equal(view.cases.length, 2);
    assert.equal(view.readiness.ready, false);
    assert.ok(view.testQuote.maxCredits > 0);
    assert.ok(!('ownerId' in view.solution));
    // Вид и шаблон решения — в ответе: по ним сайт выбирает интерфейс.
    assert.equal(view.solution.kind, 'assistant');
    assert.equal(view.solution.template, 'personal_assistant');
    const listed = (await (await call('')).json()) as { solutions: Array<Record<string, unknown>> };
    assert.equal(listed.solutions[0]?.kind, 'assistant');
    assert.equal(listed.solutions[0]?.template, 'personal_assistant');

    // Чат до включения недоступен.
    const early = await call(`/${id}/threads`, { method: 'POST' });
    assert.equal(early.status, 409);

    const run = await call(`/${id}/test-runs`, { method: 'POST', body: '{"confirm":true}' });
    assert.equal(run.status, 202);
    await app.builder.whenIdle();
    const activated = await call(`/${id}/activate`, { method: 'POST' });
    assert.equal(activated.status, 200);

    const thread = (await (await call(`/${id}/threads`, { method: 'POST' })).json()) as {
      thread: { id: string };
    };
    const reply = await call(`/${id}/threads/${thread.thread.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: 'Где мой заказ?' }),
    });
    const stream = await reply.text();
    assert.match(stream, /event: delta/);
    assert.match(stream, /Помощник отвечает: Где мой заказ\?/);
    assert.match(stream, /event: done/);

    // Просьба нарисовать — сервису изображений; без ключей он честно недоступен.
    const picture = await call(`/${id}/threads/${thread.thread.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: 'Нарисуй логотип магазина' }),
    });
    const pictureStream = await picture.text();
    assert.match(pictureStream, /event: (done|error)/);
    assert.doesNotMatch(pictureStream, /Помощник отвечает: Нарисуй/);

    const history = (await (await call(`/${id}/threads/${thread.thread.id}/messages`)).json()) as {
      messages: Array<{ role: string; model: { id: string } | null }>;
    };
    assert.deepEqual(
      history.messages.map((item) => item.role),
      ['user', 'assistant', 'user', 'assistant'],
    );
    assert.equal(history.messages[1].model?.id, 'ketner-pro');

    // Другой пользователь не видит помощника, его чат и не может его изменить.
    const otherToken = await signup(app.base, 'builder-stranger@example.com');
    const other = { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' };
    for (const [method, path] of [
      ['GET', `/${id}`],
      ['GET', `/${id}/threads/${thread.thread.id}/messages`],
      ['POST', `/${id}/activate`],
      ['DELETE', `/${id}`],
    ]) {
      const response = await fetch(`${app.base}/api/solutions${path}`, { method, headers: other });
      assert.equal(response.status, 404, `${method} ${path}`);
    }
    const foreignMessage = await fetch(
      `${app.base}/api/solutions/${id}/threads/${thread.thread.id}/messages`,
      { method: 'POST', headers: other, body: JSON.stringify({ content: 'Привет' }) },
    );
    assert.equal(foreignMessage.status, 404);
  } finally {
    app.close();
  }
});
