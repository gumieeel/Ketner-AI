/**
 * Путь пользователя «учебный помощник» по HTTP, от анализа до прогресса: рекомендация в отчёте →
 * создание из неё (вид `tool`, шаблон `study_assistant`) → загрузка → конспект и таблица → тест →
 * попытка → проверка открытого ответа → прогресс. Инструмент создаётся через API, а не вручную.
 * Ответы этапов анализа подделаны; операции инструмента идут через настоящий шлюз в демо-режиме.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { GatewayRequest, GatewayStreamCallbacks } from '../ai/gateway-types.js';
import { createApp } from '../app.js';
import type { DodoClientPort } from '../billing/automation-subscription.js';
import { BillingService, createBillingLedger } from '../billing/billing-service.js';
import { BuilderService } from '../builder/service.js';
import { MemoryBuilderStore } from '../builder/store.js';
import { MemoryBudgetStore } from '../discovery/budget.js';
import { DiscoveryService } from '../discovery/service.js';
import { MemoryDiscoveryStore } from '../discovery/store.js';
import { contextTemplate, discoveryTemplate, planTemplate } from '../discovery/templates.js';
import { setRolloutForTests } from '../services/rollout.js';
import type { MailMessage } from '../services/mailer.js';
import { createConversationStore } from '../store/conversation-store.js';
import { createSubscriptionStore } from '../store/subscription-store.js';
import { createUserStore } from '../store/user-store.js';
import { UsageStore } from '../store/usage-store.js';
import { memoryToolStores } from '../testing/builder-fixtures.js';
import { isCodeMail, rememberCodeMails, signupAndVerify } from '../testing/signup.js';

const base = JSON.parse(discoveryTemplate('ru')) as {
  opportunities: Array<Record<string, unknown>>;
};
const generic = base.opportunities[0]!;

/** Анализ ученика: учебный помощник подходит; «объяснить тему» — обычная учебная задача. */
const studyDiscovery = JSON.stringify({
  ...base,
  opportunities: [
    {
      ...generic,
      title: 'Подготовка к экзамену по своим конспектам',
      area: 'documents',
      recipe: 'study_assistant',
      problem: 'Много учебных материалов, трудно понять, что уже выучено.',
      solution: 'Загрузить материалы, получить конспект и тесты, видеть прогресс по темам.',
      requires: ['text_generation', 'document_tools'],
    },
    {
      ...generic,
      title: 'Объяснение сложной темы простыми словами',
      area: 'routine',
      // Модель ошиблась: документов эта задача не требует — рецепт должен отброситься.
      recipe: 'study_assistant',
      problem: 'Тема из учебника непонятна.',
      solution: 'Спросить ИИ в чате и получить объяснение с примерами.',
      requires: ['text_generation'],
    },
    // Готовый помощник — для проверки, что его создание по-прежнему требует подписки.
    { ...generic, title: 'Черновики писем преподавателю', area: 'documents' },
    // Остальные возможности демо-отчёта (в отчёте их не меньше трёх).
    ...base.opportunities.slice(1),
  ],
});

function journeyGateway(planMessages: string[]) {
  return {
    async stream(request: GatewayRequest, callbacks: GatewayStreamCallbacks) {
      const stage = (request.task?.id ?? '').split(':')[1];
      const input = String(request.messages[0]?.content ?? '');
      // Для проверок — весь запрос плана: системный промпт и данные.
      if (stage === 'plan') planMessages.push(`${request.task?.systemPrompt ?? ''}\n${input}`);
      const text =
        stage === 'context'
          ? contextTemplate(input, 'ru')
          : stage === 'plan'
            ? planTemplate('ru')
            : studyDiscovery;
      callbacks.onDelta(text);
      callbacks.onDone({
        inputTokens: 1,
        outputTokens: 1,
        source: 'provider',
        finishReason: 'stop',
        canContinue: false,
        selectedModel: { id: request.modelId, name: request.modelId },
        costUsd: 0.001,
        creditsUsd: request.task?.billing === 'sponsored' ? 0 : 0.001,
      });
    },
  };
}

interface StartOptions {
  planMessages?: string[];
  /** Подписка «Автоматизации» обязательна (как в продакшене с Dodo), у пользователей её нет. */
  subscriptionRequired?: boolean;
  /** Пользователи с нулевым балансом кредитов. */
  broke?: Set<string>;
}

async function start(options: StartOptions | string[] = []) {
  const {
    planMessages = [],
    subscriptionRequired = false,
    broke,
  } = Array.isArray(options) ? { planMessages: options } : options;
  const dir = mkdtempSync(join(tmpdir(), 'ketner-journey-'));
  const mails: MailMessage[] = [];
  const store = new MemoryDiscoveryStore();
  const budget = new MemoryBudgetStore();
  const builderStore = new MemoryBuilderStore();
  const tools = memoryToolStores(builderStore);
  const gateway = journeyGateway(planMessages);
  const discovery = new DiscoveryService({
    store,
    budget,
    gateway,
    balanceUsd: () => 0,
    userCapabilities: () => ({ hasPurchasedCredits: false, githubConnected: false }),
    freeDailyUsd: 5,
    budgetTimeZone: 'UTC',
  });
  const builder = new BuilderService({
    store: builderStore,
    discovery: store,
    gateway,
    balanceUsd: () => 1,
  });
  const userStore = createUserStore(join(dir, 'u.json'));
  const subscriptionStore = createSubscriptionStore(join(dir, 's.json'));
  const usageStore = new UsageStore(join(dir, 'usage.json'));
  const billing = new BillingService({
    userStore,
    subscriptionStore,
    usageStore,
    ledger: createBillingLedger(),
  });
  if (broke) {
    const balance = billing.credits.balance.bind(billing.credits);
    billing.credits.balance = (userId, plan, now) => {
      const real = balance(userId, plan, now);
      return broke.has(userId) ? { ...real, remainingUsd: 0 } : real;
    };
  }
  const app = createApp({
    store: createConversationStore(join(dir, 'c.json')),
    userStore,
    subscriptionStore,
    usageStore,
    billingService: billing,
    discoveryEnabled: true,
    // Клиент Dodo для проверки подписки не вызывается: важно лишь, что подписка настроена и обязательна.
    ...(subscriptionRequired
      ? { dodo: { client: {} as DodoClientPort, productId: 'pdt_automation', required: true } }
      : {}),
    discovery: {
      service: discovery,
      stores: () => ({ store, budget, builder: builderStore, ...tools }),
    },
    builder,
    mailer: {
      kind: 'smtp',
      async send(message) {
        if (isCodeMail(message)) mails.push(message);
      },
    },
  });
  const server: Server = app.listen(0);
  const url = `http://localhost:${(server.address() as { port: number }).port}`;
  rememberCodeMails(url, mails);
  return { base: url, discovery, builderStore, close: () => server.close() };
}

type App = Awaited<ReturnType<typeof start>>;

interface ReportOpportunity {
  id: string;
  title: string;
  recipe: string | null;
  feasibilityStatus: string;
}

async function client(app: App, email: string) {
  const response = await signupAndVerify(app.base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', name: 'Student' }),
  });
  const token = ((await response.json()) as { token: string }).token;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${app.base}/api${path}`, { ...init, headers });
  const json = async <T>(path: string, init: RequestInit = {}): Promise<T> =>
    (await (await call(path, init)).json()) as T;
  const me = (await (await call('/auth/me')).json()) as { user: { id: string } };
  return { call, json, userId: me.user.id };
}

async function report(app: App, api: Awaited<ReturnType<typeof client>>) {
  const created = await api.json<{ analysis: { id: string } }>('/analyses', {
    method: 'POST',
    body: JSON.stringify({
      text: 'Готовлюсь к экзамену по биологии: много конспектов и PDF, хочу проверять себя.',
    }),
  });
  const analysisId = created.analysis.id;
  await app.discovery.whenIdle();
  await api.call(`/analyses/${analysisId}/continue`, {
    method: 'POST',
    body: JSON.stringify({ answers: { q1: { value: 'Конспекты в PDF и DOCX' } } }),
  });
  await app.discovery.whenIdle();
  const { analysis } = await api.json<{
    analysis: { status: string; opportunities: ReportOpportunity[] };
  }>(`/analyses/${analysisId}`);
  assert.equal(analysis.status, 'ready', JSON.stringify(analysis.opportunities));
  return { analysisId, opportunities: analysis.opportunities };
}

/** Демо-режим шлюза имитирует поток с паузами — ждём до 15 секунд. */
async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  let value = await read();
  for (let i = 0; i < 300 && !done(value); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    value = await read();
  }
  return value;
}

test('учебный помощник от анализа до прогресса: рекомендация, создание, материалы, операции, попытка, проверка', async () => {
  setRolloutForTests({ studyAssistant: true });
  const planMessages: string[] = [];
  const app = await start(planMessages);
  try {
    const api = await client(app, 'journey-student@example.com');

    // 1. Анализ рекомендует учебного помощника только задаче с документами.
    const { analysisId, opportunities } = await report(app, api);
    const study = opportunities.find((item) => item.title.startsWith('Подготовка'))!;
    const explain = opportunities.find((item) => item.title.startsWith('Объяснение'))!;
    assert.equal(study.recipe, 'study_assistant');
    assert.equal(study.feasibilityStatus, 'ready');
    assert.equal(explain.recipe, null, 'обычная учебная задача — не учебный помощник');

    // План опирается на готовый инструмент.
    const plan = await api.call(`/analyses/${analysisId}/opportunities/${study.id}/plan`, {
      method: 'POST',
      body: '{}',
    });
    assert.equal(plan.status, 202);
    await app.discovery.whenIdle();
    assert.match(planMessages.at(-1) ?? '', /"readyTool":"study_assistant"/);

    // 2. Галерея показывает включённый шаблон.
    const gallery = await api.json<{ templates: Array<{ id: string; kind: string }> }>(
      '/solutions/templates',
    );
    assert.deepEqual(
      gallery.templates.map((item) => [item.id, item.kind]),
      [['study_assistant', 'tool']],
    );

    // 3. Создание из рекомендации: инструмент, сразу, без черновика моделью и без подтверждения.
    const createdResponse = await api.call('/solutions/from-opportunity', {
      method: 'POST',
      body: JSON.stringify({ analysisId, opportunityId: study.id }),
    });
    assert.equal(createdResponse.status, 201);
    const { solution } = (await createdResponse.json()) as {
      solution: { id: string; type: string; kind: string; template: string; status: string };
    };
    assert.equal(solution.type, 'tool');
    assert.equal(solution.kind, 'tool');
    assert.equal(solution.template, 'study_assistant');
    assert.equal(solution.status, 'active');
    // Повтор — тот же инструмент, без второго.
    const again = await api.call('/solutions/from-opportunity', {
      method: 'POST',
      body: JSON.stringify({ analysisId, opportunityId: study.id }),
    });
    assert.equal(again.status, 200);
    assert.equal(((await again.json()) as { solution: { id: string } }).solution.id, solution.id);
    // Чат помощника у инструмента недоступен — подмены нет.
    assert.equal(
      (await api.call(`/solutions/${solution.id}/threads`, { method: 'POST' })).status,
      409,
    );

    const tool = (path: string, init: RequestInit = {}) =>
      api.json<Record<string, unknown>>(`/solutions/${solution.id}${path}`, init);
    const view = (await tool('')) as { config: { tool: string; subject: string } };
    assert.equal(view.config.tool, 'study_assistant');

    // 4. Загрузка материала.
    const uploaded = (await tool('/materials', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Биология.pdf',
        format: 'pdf',
        sizeBytes: 9000,
        sections: [
          { label: 'Стр. 1', text: 'Клетка — основная единица строения всех живых организмов.' },
          { label: 'Стр. 2', text: 'Ядро хранит наследственную информацию в молекулах ДНК.' },
        ],
      }),
    })) as { material: { id: string } };
    const materials = [{ id: uploaded.material.id }];

    // 5. Операции: цена → запуск с принятой ценой → результат.
    let seq = 0;
    const run = async (operation: string, input: Record<string, unknown>) => {
      const { quote } = (await tool('/runs/quote', {
        method: 'POST',
        body: JSON.stringify({ operation, input }),
      })) as { quote: { maxCredits: number } };
      assert.ok(quote.maxCredits > 0);
      const started = await api.call(`/solutions/${solution.id}/runs`, {
        method: 'POST',
        body: JSON.stringify({
          operation,
          input,
          idempotencyKey: `journey-${operation}-${(seq += 1)}`,
          acceptedMaxCredits: quote.maxCredits,
          confirm: true,
        }),
      });
      assert.equal(started.status, 202, operation);
      const runId = ((await started.json()) as { run: { id: string } }).run.id;
      const done = await waitFor(
        async () =>
          ((await tool(`/runs/${runId}`)) as { run: { status: string; result: unknown } }).run,
        (value) => value.status === 'done' || value.status === 'failed',
      );
      assert.equal(done.status, 'done', `${operation}: ${JSON.stringify(done)}`);
      return { runId, result: done.result };
    };
    const notes = await run('notes', { subject: 'Биология', materials });
    assert.ok(JSON.stringify(notes.result).includes('sections'));
    const table = await run('table', { subject: 'Биология', materials });
    assert.ok(JSON.stringify(table.result).includes('columns'));
    const quiz = await run('quiz', { subject: 'Биология', materials, count: 3, format: 'mixed' });
    assert.ok(!JSON.stringify(quiz.result).includes('correctIndex'));

    // 6. Попытка, сдача, проверка открытого ответа за кредиты с ценой.
    const { attempt } = (await tool(`/runs/${quiz.runId}/attempts`, {
      method: 'POST',
      body: '{}',
    })) as { attempt: { id: string; questions: Array<{ id: string; type: string }> } };
    const [first, second, third] = attempt.questions;
    const submitted = (await tool(`/attempts/${attempt.id}/submit`, {
      method: 'POST',
      body: JSON.stringify({
        answers: {
          [first!.id]: { selected: 0 },
          [second!.id]: { text: 'Ядро хранит наследственную информацию в молекулах ДНК.' },
          [third!.id]: { selected: 1 },
        },
      }),
    })) as { attempt: { results: Array<{ verdict: string }> } };
    assert.ok(submitted.attempt.results.some((item) => item.verdict === 'pending'));
    const { quote: gradeQuote } = (await tool(`/attempts/${attempt.id}/grade/quote`, {
      method: 'POST',
      body: '{}',
    })) as { quote: { maxCredits: number } };
    const grading = await api.call(`/solutions/${solution.id}/attempts/${attempt.id}/grade`, {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: 'journey-grade-1',
        acceptedMaxCredits: gradeQuote.maxCredits,
        confirm: true,
      }),
    });
    assert.equal(grading.status, 202);
    const graded = await waitFor(
      async () =>
        ((await tool(`/attempts/${attempt.id}`)) as { attempt: { status: string } }).attempt,
      (value) => value.status === 'graded',
    );
    assert.equal(graded.status, 'graded');

    // 7. Прогресс по сданной попытке.
    const { progress } = (await tool('/progress')) as {
      progress: { totals: { completed: number; answered: number }; history: unknown[] };
    };
    assert.equal(progress.totals.completed, 1);
    assert.equal(progress.totals.answered, 3);
    assert.equal(progress.history.length, 1);
  } finally {
    app.close();
    setRolloutForTests(null);
  }
});

test('учебный помощник выключен: нет в рекомендациях, в галерее и при создании — без подмены чатом', async () => {
  setRolloutForTests({ studyAssistant: false });
  const planMessages: string[] = [];
  const app = await start(planMessages);
  try {
    const api = await client(app, 'journey-off@example.com');
    const { analysisId, opportunities } = await report(app, api);
    assert.ok(opportunities.every((item) => item.recipe !== 'study_assistant'));
    // Модель назвала требование document_tools, но в отчёт оно не попало — ни как «есть», ни как «пока нет».
    const reportText = JSON.stringify(opportunities);
    assert.ok(!reportText.includes('document_tools'));
    assert.ok(!/учебный помощник|Учёба по своим документам/i.test(reportText));
    // План по бывшей «учебной» возможности не получает ни возможности, ни готового инструмента.
    const plan = await api.call(
      `/analyses/${analysisId}/opportunities/${opportunities.find((item) => item.title.startsWith('Подготовка'))!.id}/plan`,
      { method: 'POST', body: '{}' },
    );
    assert.equal(plan.status, 202);
    await app.discovery.whenIdle();
    const planRequest = planMessages.at(-1) ?? '';
    assert.ok(planRequest.length > 0);
    assert.ok(!planRequest.includes('document_tools'));
    assert.ok(!planRequest.includes('study_assistant'));
    assert.match(planRequest, /"readyTool":null/);

    const gallery = await api.json<{ templates: unknown[] }>('/solutions/templates');
    assert.deepEqual(gallery.templates, []);

    const direct = await api.call('/solutions', {
      method: 'POST',
      body: JSON.stringify({ template: 'study_assistant' }),
    });
    assert.equal(direct.status, 409);
    assert.equal(
      ((await direct.json()) as { error: { code: string } }).error.code,
      'template_unavailable',
    );
    // Помощник через шаблон галереи не создаётся, неизвестный шаблон — тоже отказ.
    for (const template of ['personal_assistant', 'customer_bot', 'study_assistant_v2']) {
      const refused = await api.call('/solutions', {
        method: 'POST',
        body: JSON.stringify({ template }),
      });
      assert.equal(refused.status, 409, template);
    }
    // Пустой помощник создаётся как раньше.
    const blank = await api.call('/solutions', {
      method: 'POST',
      body: JSON.stringify({ name: 'Мой помощник' }),
    });
    assert.equal(blank.status, 201);
    assert.equal(
      ((await blank.json()) as { solution: { type: string } }).solution.type,
      'assistant',
    );
    assert.equal(
      (await api.call('/solutions', { method: 'POST', body: '{}' })).status,
      400,
      'без имени и шаблона — ошибка проверки',
    );
    const list = await api.json<{ solutions: unknown[] }>('/solutions');
    assert.equal(list.solutions.length, 1);
    assert.ok(analysisId);
  } finally {
    app.close();
    setRolloutForTests(null);
  }
});

test('учебный помощник из галереи: инструмент с названием шаблона или своим именем', async () => {
  setRolloutForTests({ studyAssistant: true });
  const app = await start();
  try {
    const api = await client(app, 'journey-gallery@example.com');
    const created = await api.call('/solutions', {
      method: 'POST',
      body: JSON.stringify({ template: 'study_assistant' }),
    });
    assert.equal(created.status, 201);
    const { solution } = (await created.json()) as {
      solution: { id: string; name: string; type: string; template: string; status: string };
    };
    assert.deepEqual(
      [solution.name, solution.type, solution.template, solution.status],
      ['Учебный помощник', 'tool', 'study_assistant', 'active'],
    );
    const named = await api.call('/solutions', {
      method: 'POST',
      body: JSON.stringify({ template: 'study_assistant', name: 'ЕНТ: история', language: 'en' }),
    });
    const second = ((await named.json()) as { solution: { id: string; name: string } }).solution;
    assert.equal(second.name, 'ЕНТ: история');
    const view = await api.json<{ config: { language: string } }>(`/solutions/${second.id}`);
    assert.equal(view.config.language, 'en');
  } finally {
    app.close();
    setRolloutForTests(null);
  }
});

test('учебный помощник бесплатен без подписки из обеих точек входа; остальное — как раньше', async () => {
  setRolloutForTests({ studyAssistant: true });
  const broke = new Set<string>();
  const app = await start({ subscriptionRequired: true, broke });
  try {
    const api = await client(app, 'journey-nosub@example.com');
    const automation = await api.json<{ available: boolean; subscription: unknown }>(
      '/billing/automation',
    );
    assert.equal(automation.available, true);
    assert.equal(automation.subscription, null, 'подписки нет');

    // Галерея: без подписки.
    const fromGallery = await api.call('/solutions', {
      method: 'POST',
      body: JSON.stringify({ template: 'study_assistant' }),
    });
    assert.equal(fromGallery.status, 201);

    // Рекомендация анализа: тоже без подписки, и это инструмент.
    const { analysisId, opportunities } = await report(app, api);
    const study = opportunities.find((item) => item.recipe === 'study_assistant')!;
    const assistant = opportunities.find((item) => item.recipe === 'personal_assistant')!;
    assert.ok(study && assistant);
    const fromReport = await api.call('/solutions/from-opportunity', {
      method: 'POST',
      body: JSON.stringify({ analysisId, opportunityId: study.id }),
    });
    assert.equal(fromReport.status, 201);
    const tool = ((await fromReport.json()) as { solution: { id: string; type: string } }).solution;
    assert.equal(tool.type, 'tool');

    // Помощник из той же рекомендации и несуществующая возможность — подписка обязательна.
    for (const opportunityId of [assistant.id, 'missing']) {
      const gated = await api.call('/solutions/from-opportunity', {
        method: 'POST',
        body: JSON.stringify({ analysisId, opportunityId, confirm: true }),
      });
      assert.equal(gated.status, 402, opportunityId);
      assert.equal(
        ((await gated.json()) as { error: { code: string } }).error.code,
        'subscription_required',
      );
    }
    // Чужой анализ с рецептом учебного помощника исключения не даёт.
    const stranger = await client(app, 'journey-nosub-2@example.com');
    const foreign = await stranger.call('/solutions/from-opportunity', {
      method: 'POST',
      body: JSON.stringify({ analysisId, opportunityId: study.id }),
    });
    assert.equal(foreign.status, 402);

    // Операции инструмента — по-прежнему за кредиты: цена, подтверждение, баланс.
    const uploaded = await api.json<{ material: { id: string } }>(
      `/solutions/${tool.id}/materials`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Биология.txt',
          format: 'txt',
          sizeBytes: 100,
          sections: [{ label: 'Часть 1', text: 'Ядро хранит ДНК.' }],
        }),
      },
    );
    const input = { subject: 'Биология', materials: [{ id: uploaded.material.id }] };
    const { quote } = await api.json<{ quote: { maxCredits: number } }>(
      `/solutions/${tool.id}/runs/quote`,
      { method: 'POST', body: JSON.stringify({ operation: 'notes', input }) },
    );
    assert.ok(quote.maxCredits > 0, 'у операции есть цена');
    const unaccepted = await api.call(`/solutions/${tool.id}/runs`, {
      method: 'POST',
      body: JSON.stringify({
        operation: 'notes',
        input,
        idempotencyKey: 'nosub-notes-1',
        acceptedMaxCredits: 0,
      }),
    });
    assert.equal(unaccepted.status, 409);
    assert.equal(
      ((await unaccepted.json()) as { error: { code: string } }).error.code,
      'confirmation_required',
    );
    broke.add(api.userId);
    const poor = await api.call(`/solutions/${tool.id}/runs`, {
      method: 'POST',
      body: JSON.stringify({
        operation: 'notes',
        input,
        idempotencyKey: 'nosub-notes-2',
        acceptedMaxCredits: quote.maxCredits,
        confirm: true,
      }),
    });
    assert.equal(poor.status, 402);
    assert.equal(
      ((await poor.json()) as { error: { code: string } }).error.code,
      'insufficient_credits',
    );
    const runs = await api.json<{ runs: unknown[] }>(`/solutions/${tool.id}/runs`);
    assert.equal(runs.runs.length, 0, 'без цены и без кредитов запусков нет');
  } finally {
    app.close();
    setRolloutForTests(null);
  }
});

test('учебный помощник выключен: исключение из подписки не открывает создание', async () => {
  setRolloutForTests({ studyAssistant: true });
  const app = await start({ subscriptionRequired: true });
  try {
    const api = await client(app, 'journey-nosub-off@example.com');
    const { analysisId, opportunities } = await report(app, api);
    const study = opportunities.find((item) => item.recipe === 'study_assistant')!;
    setRolloutForTests({ studyAssistant: false });
    const refused = await api.call('/solutions/from-opportunity', {
      method: 'POST',
      body: JSON.stringify({ analysisId, opportunityId: study.id }),
    });
    assert.equal(refused.status, 409);
    assert.equal(
      ((await refused.json()) as { error: { code: string } }).error.code,
      'template_unavailable',
    );
    assert.deepEqual((await api.json<{ solutions: unknown[] }>('/solutions')).solutions, []);
  } finally {
    app.close();
    setRolloutForTests(null);
  }
});
