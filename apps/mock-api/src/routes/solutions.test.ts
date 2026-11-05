import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { GatewayRequest, GatewayStreamCallbacks } from '../ai/gateway-types.js';
import { createApp } from '../app.js';
import { BuilderService, defaultConfig, draftTemplate } from '../builder/service.js';
import { MemoryBuilderStore } from '../builder/store.js';
import { MemoryMaterialStore } from '../builder/tools/material-store.js';
import { MemoryRunStore } from '../builder/tools/run-store.js';
import { STUDY_CONFIG, toolSolution } from '../testing/builder-fixtures.js';
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
  const materials = new MemoryMaterialStore((ownerId, id) => builderStore.getSolution(ownerId, id));
  const runs = new MemoryRunStore((ownerId, id) => builderStore.getSolution(ownerId, id));
  const stores = () => ({ store, budget, builder: builderStore, materials, runs });
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
  return { base, discovery, builder, builderStore, close: () => server.close() };
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

test('материалы инструмента по HTTP: загрузка, дубль, просмотр, удаление; чужой — 404; действия помощника — 409', async () => {
  const app = await start();
  try {
    const owner = await signup(app.base, 'study-owner@example.com');
    const stranger = await signup(app.base, 'study-stranger@example.com');
    const headers = (token: string) => ({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    });
    const me = (await (
      await fetch(`${app.base}/api/auth/me`, { headers: headers(owner) })
    ).json()) as { user: { id: string } };
    // Шаблон пока недоступен для создания через API — инструмент кладётся прямо в хранилище.
    await app.builderStore.createSolution(
      toolSolution('study-1', me.user.id),
      {
        solutionId: 'study-1',
        number: 1,
        config: STUDY_CONFIG,
        createdAt: new Date().toISOString(),
      },
      [],
    );
    const call = (token: string, path: string, init: RequestInit = {}) =>
      fetch(`${app.base}/api/solutions/study-1${path}`, { ...init, headers: headers(token) });
    const document = {
      name: 'Биология.pdf',
      format: 'pdf',
      sizeBytes: 120_000,
      sections: [
        { label: 'Стр. 1', text: 'Клетка — основная единица живого.' },
        { label: 'Стр. 2', text: '' },
        { label: 'Стр. 3', text: 'Ядро хранит ДНК.' },
      ],
    };

    assert.equal((await fetch(`${app.base}/api/solutions/study-1/materials`)).status, 401);

    // Страница инструмента: вид, шаблон и его настройки, без кейсов и тестов помощника.
    const view = (await (await call(owner, '')).json()) as Record<string, unknown> & {
      solution: Record<string, unknown>;
    };
    assert.equal(view.solution.kind, 'tool');
    assert.equal(view.solution.template, 'study_assistant');
    assert.deepEqual(view.config, STUDY_CONFIG);
    assert.ok(!('cases' in view) && !('readiness' in view));

    const created = await call(owner, '/materials', {
      method: 'POST',
      body: JSON.stringify(document),
    });
    assert.equal(created.status, 201);
    const { material } = (await created.json()) as {
      material: { id: string; sections: Array<{ id: string; label: string }> } & Record<
        string,
        unknown
      >;
    };
    assert.deepEqual(
      material.sections.map((section) => [section.id, section.label]),
      [
        ['s1', 'Стр. 1'],
        ['s2', 'Стр. 3'],
      ],
    );
    assert.ok(!('ownerId' in material) && !('contentHash' in material));

    const duplicate = await call(owner, '/materials', {
      method: 'POST',
      body: JSON.stringify(document),
    });
    assert.equal(duplicate.status, 200);
    assert.equal(((await duplicate.json()) as { duplicate: boolean }).duplicate, true);

    // Неверное тело и скан без текста.
    const invalid = await call(owner, '/materials', {
      method: 'POST',
      body: JSON.stringify({ ...document, format: 'exe' }),
    });
    assert.equal(invalid.status, 400);
    const scan = await call(owner, '/materials', {
      method: 'POST',
      body: JSON.stringify({ ...document, sections: [{ label: '1', text: '  ' }] }),
    });
    assert.equal(scan.status, 422);
    assert.equal(
      ((await scan.json()) as { error: { code: string } }).error.code,
      'material_no_text',
    );

    // Тело больше 1 МБ, но в пределах 2 МБ принимается; больше 2 МБ — 413 до разбора.
    const near = 'ж'.repeat(190_000); // ≈ 380 КБ в UTF-8 — плюс экранирование
    const large = await call(owner, '/materials', {
      method: 'POST',
      body: JSON.stringify({
        ...document,
        sections: [
          { label: '1', text: near },
          { label: '2', text: '"\\'.repeat(5_000) },
        ],
      }),
    });
    assert.equal(large.status, 201);
    const huge = await call(owner, '/materials', {
      method: 'POST',
      body: JSON.stringify({
        ...document,
        sections: [{ label: '1', text: '\u0001'.repeat(400_000) }],
      }),
    });
    assert.equal(huge.status, 413);

    const list = (await (await call(owner, '/materials')).json()) as {
      materials: Array<{ id: string }>;
      usage: { count: number; maxCount: number };
    };
    assert.equal(list.materials.length, 2);
    assert.equal(list.usage.count, 2);
    assert.ok(!JSON.stringify(list).includes('Клетка'));

    const full = (await (await call(owner, `/materials/${material.id}`)).json()) as {
      material: { sections: Array<{ text: string }> };
    };
    assert.equal(full.material.sections[0]?.text, 'Клетка — основная единица живого.');

    // Чужой пользователь не видит ни инструмента, ни материалов.
    assert.equal((await call(stranger, '/materials')).status, 404);
    assert.equal((await call(stranger, `/materials/${material.id}`)).status, 404);
    assert.equal(
      (await call(stranger, '/materials', { method: 'POST', body: JSON.stringify(document) }))
        .status,
      404,
    );
    assert.equal(
      (await call(stranger, `/materials/${material.id}`, { method: 'DELETE' })).status,
      404,
    );

    // Действия помощника над инструментом — 409, а не чат или тесты.
    for (const [path, init] of [
      ['/config', { method: 'PUT', body: JSON.stringify({ config: defaultConfig('Чат', 'ru') }) }],
      [
        '/cases',
        { method: 'POST', body: JSON.stringify({ input: 'вопрос', criteria: ['ответ'] }) },
      ],
      ['/test-runs', { method: 'POST', body: JSON.stringify({ confirm: true }) }],
      ['/activate', { method: 'POST' }],
      ['/pause', { method: 'POST' }],
      ['/threads', { method: 'GET' }],
    ] as const) {
      const response = await call(owner, path, init);
      assert.equal(response.status, 409, path);
      const body = (await response.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'wrong_solution_kind', path);
    }

    assert.equal(
      (await call(owner, `/materials/${material.id}`, { method: 'DELETE' })).status,
      204,
    );
    assert.equal((await call(owner, `/materials/${material.id}`)).status, 404);
  } finally {
    app.close();
  }
});

test('запуски инструмента по HTTP: цена, подтверждение, запуск, результат, история, ключ, чужой — 404', async () => {
  const app = await start();
  try {
    const owner = await signup(app.base, 'runs-owner@example.com');
    const stranger = await signup(app.base, 'runs-stranger@example.com');
    const headers = (token: string) => ({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    });
    const me = (await (
      await fetch(`${app.base}/api/auth/me`, { headers: headers(owner) })
    ).json()) as { user: { id: string } };
    await app.builderStore.createSolution(
      toolSolution('study-runs', me.user.id),
      {
        solutionId: 'study-runs',
        number: 1,
        config: STUDY_CONFIG,
        createdAt: new Date().toISOString(),
      },
      [],
    );
    const call = (token: string, path: string, init: RequestInit = {}) =>
      fetch(`${app.base}/api/solutions/study-runs${path}`, { ...init, headers: headers(token) });
    const uploaded = (await (
      await call(owner, '/materials', {
        method: 'POST',
        body: JSON.stringify({
          name: 'История.docx',
          format: 'docx',
          sizeBytes: 5000,
          sections: [
            { label: 'Часть 1', text: 'Реформы Петра I начались в 1700 году.' },
            { label: 'Часть 2', text: 'В 1703 году основан Санкт-Петербург.' },
          ],
        }),
      })
    ).json()) as { material: { id: string } };
    const input = { subject: 'История', materials: [{ id: uploaded.material.id }] };

    const quoted = await call(owner, '/runs/quote', {
      method: 'POST',
      body: JSON.stringify({ operation: 'table', input }),
    });
    assert.equal(quoted.status, 200);
    const { quote } = (await quoted.json()) as {
      quote: { maxCredits: number; typicalCredits: number; model: string; inputChars: number };
    };
    assert.ok(quote.maxCredits >= quote.typicalCredits && quote.maxCredits > 0);
    assert.equal(quote.model, 'MiMo-V2.6 Pro');

    // Без принятой цены — 409 с ценой, запуска нет.
    const unconfirmed = await call(owner, '/runs', {
      method: 'POST',
      body: JSON.stringify({
        operation: 'table',
        input,
        idempotencyKey: 'http-key-0001',
        acceptedMaxCredits: 0,
      }),
    });
    assert.equal(unconfirmed.status, 409);
    assert.equal(
      ((await unconfirmed.json()) as { error: { code: string } }).error.code,
      'confirmation_required',
    );
    // Неверное тело — 400.
    const malformed = await call(owner, '/runs', {
      method: 'POST',
      body: JSON.stringify({ operation: 'table', input, idempotencyKey: 'x' }),
    });
    assert.equal(malformed.status, 400);

    const body = JSON.stringify({
      operation: 'table',
      input,
      idempotencyKey: 'http-key-0002',
      acceptedMaxCredits: quote.maxCredits,
    });
    const started = await call(owner, '/runs', { method: 'POST', body });
    assert.equal(started.status, 202, await started.clone().text());
    const { run } = (await started.json()) as { run: { id: string; status: string } };
    assert.equal(run.status, 'queued');

    // Повтор с тем же ключом — тот же запуск.
    const repeated = await call(owner, '/runs', { method: 'POST', body });
    assert.equal(repeated.status, 200);
    const again = (await repeated.json()) as { run: { id: string }; duplicate: boolean };
    assert.equal(again.run.id, run.id);
    assert.equal(again.duplicate, true);

    // Результат: таблица со ссылками на части документа.
    let view: {
      status: string;
      result: { columns: string[]; rows: Array<{ cells: string[]; sources: string[] }> } | null;
      sources: Array<{ ref: string; label: string; materialName: string }>;
      chargedCredits: number;
    } & Record<string, unknown> = {
      status: 'queued',
      result: null,
      sources: [],
      chargedCredits: 0,
    };
    // Демо-режим шлюза (без ключа модели) имитирует поток с паузами — ждём до 15 секунд.
    for (let i = 0; i < 300 && view.status !== 'done' && view.status !== 'failed'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      view = ((await (await call(owner, `/runs/${run.id}`)).json()) as { run: typeof view }).run;
    }
    assert.equal(view.status, 'done', JSON.stringify(view));
    assert.equal(view.result?.columns.length, 2);
    assert.deepEqual(view.result?.rows[0]?.sources, ['S1']);
    assert.deepEqual(
      view.sources.map((source) => [source.ref, source.label, source.materialName]),
      [
        ['S1', 'Часть 1', 'История.docx'],
        ['S2', 'Часть 2', 'История.docx'],
      ],
    );
    for (const hidden of ['ownerId', 'claimToken', 'inputHash', 'idempotencyKey', 'costUsd']) {
      assert.ok(!(hidden in view), hidden);
    }

    const history = (await (await call(owner, '/runs')).json()) as {
      runs: Array<{ id: string; title: string | null; subject: string } & Record<string, unknown>>;
    };
    assert.equal(history.runs.length, 1);
    assert.equal(history.runs[0]?.subject, 'История');
    assert.ok(!('result' in history.runs[0]!));

    // Чужой — 404 везде.
    assert.equal((await call(stranger, '/runs')).status, 404);
    assert.equal((await call(stranger, `/runs/${run.id}`)).status, 404);
    assert.equal(
      (
        await call(stranger, '/runs/quote', {
          method: 'POST',
          body: JSON.stringify({ operation: 'table', input }),
        })
      ).status,
      404,
    );
    assert.equal((await call(stranger, `/runs/${run.id}`, { method: 'DELETE' })).status, 404);

    assert.equal((await call(owner, `/runs/${run.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await call(owner, `/runs/${run.id}`)).status, 404);
  } finally {
    app.close();
  }
});
