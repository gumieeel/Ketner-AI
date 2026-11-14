/**
 * Сквозная приёмка платформы решений (этап 9, docs/MIGRATION_PLAN.md):
 * главная → анализ гостя → вопросы → отчёт → краткий план → вход → подробный план за кредиты →
 * покупка пакета (тестовый режим оплаты) → помощник из возможности → проверка → включение → чат.
 *
 * Всё через HTTP настоящего приложения: настоящий AI Gateway (выбор модели, цена, списание
 * кредитов, учёт), настоящий BillingService и кредиты; подменён только провайдер моделей — он
 * отвечает по системному промпту этапа и называет цену вызова, как OpenRouter.
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CircuitBreaker } from '../ai/circuit-breaker.js';
import { AIGateway } from '../ai/gateway.js';
import type {
  AIProvider,
  ProviderRequestOptions,
  ProviderResponse,
  ProviderStreamCallbacks,
} from '../ai/gateway-types.js';
import { ModelRegistry } from '../ai/model-registry.js';
import { ProviderManager } from '../ai/providers/provider-factory.js';
import { BillingService, createBillingLedger } from '../billing/billing-service.js';
import { MemoryBuilderStore } from '../builder/store.js';
import { memoryToolStores } from '../testing/builder-fixtures.js';
import { MemoryBudgetStore } from '../discovery/budget.js';
import { MemoryDiscoveryStore } from '../discovery/store.js';
import { CREDIT_PACKS } from '../services/pricing.js';
import { TRIAL_CREDITS, type CreditsReport } from '../services/credits.js';
import { createSubscriptionStore } from '../store/subscription-store.js';
import { createUserStore } from '../store/user-store.js';
import { UsageStore } from '../store/usage-store.js';
import { FAST_AI, startTestServer } from '../testing/server.js';
import { signupAndVerify } from '../testing/signup.js';

const CALL_COST_USD = 0.003;

const CONTEXT = {
  domain: 'Интернет-магазин',
  summary: 'Отвечаю покупателям на однотипные вопросы',
  tasks: [{ id: 't1', title: 'Ответы покупателям', source: 'user' }],
  questions: [
    { id: 'q1', text: 'Где хранятся заказы?', reason: 'Интеграции', optional: false, kind: 'text' },
  ],
};
const DISCOVERY = {
  summary: 'Больше всего поможет ИИ в ответах покупателям.',
  opportunities: [
    {
      title: 'Черновики ответов',
      problem: 'Однотипные вопросы',
      solution: 'ИИ пишет черновик',
      requires: ['text_generation'],
      effort: 'low',
      impact: { taskId: 't1', automationShare: 'medium', benefit: 'Быстрее отвечать' },
      firstStep: 'Соберите частые вопросы',
    },
    {
      title: 'Скрипт через API',
      problem: 'Ручное копирование',
      solution: 'Скрипт вызывает модель',
      requires: ['api_access'],
      effort: 'medium',
      impact: { taskId: null, automationShare: 'low', benefit: 'Меньше копирования' },
    },
    {
      title: 'Автоответы в почте',
      problem: 'Однотипные письма',
      solution: 'ИИ отвечает сам',
      requires: ['email'],
      effort: 'high',
      impact: { taskId: null, automationShare: 'high', benefit: 'Меньше писем' },
    },
  ],
};
const PLAN = {
  summary: 'Начните с черновиков.',
  steps: [
    { id: 's1', title: 'Соберите вопросы', dependsOn: [], doneWhen: 'Есть список' },
    { id: 's2', title: 'Попробуйте в чате', dependsOn: ['s1'], doneWhen: 'Есть черновик' },
  ],
  risks: ['Ошибки'],
  successCriteria: ['Ответ за минуту'],
};
const DRAFT = {
  name: 'Помощник магазина',
  purpose: 'Отвечает покупателям',
  instructions: 'Отвечай кратко.',
  tone: 'friendly',
  knowledge: 'Доставка 3 дня.',
  examples: [],
  restrictions: ['Не выдумывать цены'],
  testCases: [
    { input: 'Сколько ехать заказу?', criteria: ['Называет срок'] },
    { input: 'Привет!', criteria: ['Здоровается'] },
  ],
};

/** Поддельный OpenRouter: этап узнаётся по системному промпту, у каждого ответа есть цена. */
function fakeProvider(calls: string[]): AIProvider {
  const reply = (options: ProviderRequestOptions): string => {
    const system =
      options.systemPrompt ??
      options.messages.find((message) => message.role === 'system')?.content ??
      '';
    if (system.includes('Извлеки из описания структурированный профиль бизнеса'))
      return JSON.stringify(CONTEXT);
    if (system.includes('найди 3–7 конкретных применений')) return JSON.stringify(DISCOVERY);
    if (system.includes('консультант по внедрению')) return JSON.stringify(PLAN);
    if (system.includes('настраиваешь персонального ИИ-помощника')) return JSON.stringify(DRAFT);
    if (system.includes('проверяешь ответ ИИ-помощника'))
      return JSON.stringify({ criteria: [{ criterion: 'c', met: true, note: '' }], notes: '' });
    if (system.includes('<assistant_settings>')) return 'Доставка занимает 3 дня. Здравствуйте!';
    return 'Обычный ответ чата';
  };
  const answer = async (
    options: ProviderRequestOptions,
    cb?: ProviderStreamCallbacks,
  ): Promise<ProviderResponse> => {
    calls.push(options.model);
    const text = reply(options);
    cb?.onDelta(text);
    return {
      content: text,
      usage: { inputTokens: 1000, outputTokens: 300 },
      finishReason: 'stop',
      cost: CALL_COST_USD,
    };
  };
  return {
    type: 'openrouter',
    name: 'FakeOpenRouter',
    isAvailable: () => true,
    generateText: (options) => answer(options),
    streamText: (options, cb) => answer(options, cb),
  } as AIProvider;
}

async function until<T>(check: () => Promise<T | null | undefined>, label: string): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`не дождались: ${label}`);
}

test('сквозной путь: главная → анализ → вопросы → отчёт → план → оплата → помощник → тест → чат', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ketner-e2e-'));
  const usageStore = new UsageStore(join(dir, 'usage.json'));
  const userStore = createUserStore(join(dir, 'users.json'));
  const subscriptionStore = createSubscriptionStore(join(dir, 'subs.json'));
  const billing = new BillingService({
    userStore,
    subscriptionStore,
    usageStore,
    ledger: createBillingLedger(),
  });
  const calls: string[] = [];
  const providers = new ProviderManager();
  providers.setProvider('openrouter', fakeProvider(calls));
  const chatGateway = new AIGateway({
    registry: new ModelRegistry(),
    providers,
    usageStore,
    aiConfig: FAST_AI,
    circuitBreaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 }),
    useMockEngine: false,
    credits: billing.credits,
  });
  const builderStore = new MemoryBuilderStore();
  const stores = {
    store: new MemoryDiscoveryStore(),
    budget: new MemoryBudgetStore(),
    builder: builderStore,
    ...memoryToolStores(builderStore),
  };
  const server = await startTestServer(
    {},
    {
      userStore,
      subscriptionStore,
      billingService: billing,
      usageStore,
      chatGateway,
      discoveryEnabled: true,
      discovery: { stores: () => stores },
    },
  );
  t.after(() => server.close());
  const base = server.baseUrl;
  const guest = 'guest_e2eflow01';
  const guestHeaders = { 'Content-Type': 'application/json', 'X-Guest-Id': guest };
  const json = async <T>(response: Response): Promise<T> => (await response.json()) as T;
  type View = {
    analysis: {
      id: string;
      status: string;
      questions: Array<{ id: string }>;
      opportunities: Array<{ id: string; title: string; feasibilityStatus: string }>;
      cost: { chargedCredits: number; sponsored: boolean };
    };
    plans: {
      offer: { free: { available: boolean }; paid: { maxCredits: number } };
    } | null;
  };

  // 1. Главная — новое позиционирование, флаг передан сайту.
  const home = await (await fetch(`${base}/`)).text();
  assert.match(home, /<meta name="ketner-features" content="discovery"/);

  // 2. Гость: анализ бесплатно, вопросы, черновик ответов, отчёт.
  const created = await fetch(`${base}/api/analyses`, {
    method: 'POST',
    headers: { ...guestHeaders, 'Idempotency-Key': 'e2e-analysis-0001' },
    body: JSON.stringify({
      text: 'Веду интернет-магазин, отвечаю покупателям на однотипные вопросы.',
    }),
  });
  assert.equal(created.status, 202);
  const id = (await json<View>(created)).analysis.id;
  const getView = async (headers: Record<string, string>) =>
    json<View>(await fetch(`${base}/api/analyses/${id}`, { headers }));
  const asked = await until(async () => {
    const view = await getView(guestHeaders);
    return view.analysis.status === 'needs_answers' ? view : null;
  }, 'вопросы');
  assert.deepEqual(
    asked.analysis.questions.map((question) => question.id),
    ['q1'],
  );
  const draft = await fetch(`${base}/api/analyses/${id}/answers`, {
    method: 'PUT',
    headers: guestHeaders,
    body: JSON.stringify({ answers: { q1: { value: 'В Google Таблицах' } } }),
  });
  assert.equal(draft.status, 200);
  await fetch(`${base}/api/analyses/${id}/continue`, {
    method: 'POST',
    headers: guestHeaders,
    body: JSON.stringify({ answers: { q1: { value: 'В Google Таблицах' } } }),
  });
  const report = await until(async () => {
    const view = await getView(guestHeaders);
    return view.analysis.status === 'ready' ? view : null;
  }, 'отчёт');
  assert.deepEqual(
    report.analysis.opportunities.map((item) => [item.title, item.feasibilityStatus]),
    [
      ['Черновики ответов', 'ready'],
      ['Скрипт через API', 'needs_setup'],
      ['Автоответы в почте', 'not_supported'],
    ],
  );
  assert.deepEqual(report.analysis.cost, { chargedCredits: 0, sponsored: true });
  // Бесплатные вызовы — GPT-6 Luna, без подмены.
  assert.ok(
    calls.every((model) => model === 'openai/gpt-6-luna'),
    calls.join(','),
  );
  const byTitle = (title: string) =>
    report.analysis.opportunities.find((item) => item.title === title)!.id;

  // 3. Краткий план — бесплатно; у неподдерживаемой возможности плана нет.
  const refused = await fetch(
    `${base}/api/analyses/${id}/opportunities/${byTitle('Автоответы в почте')}/plan`,
    { method: 'POST', headers: guestHeaders, body: '{}' },
  );
  assert.equal(refused.status, 409);
  const brief = await fetch(
    `${base}/api/analyses/${id}/opportunities/${byTitle('Черновики ответов')}/plan`,
    { method: 'POST', headers: guestHeaders, body: '{}' },
  );
  assert.equal(brief.status, 202);
  const briefId = (await json<{ plan: { id: string } }>(brief)).plan.id;
  const briefPlan = await until(async () => {
    const body = await json<{
      plan: { status: string; kind: string; cost: { chargedCredits: number } };
    }>(await fetch(`${base}/api/analyses/${id}/plans/${briefId}`, { headers: guestHeaders }));
    return body.plan.status === 'ready' ? body.plan : null;
  }, 'краткий план');
  assert.equal(briefPlan.kind, 'brief');
  assert.equal(briefPlan.cost.chargedCredits, 0);

  // 4. Вход: анализ гостя переходит в аккаунт; пробные кредиты целы.
  const signup = await signupAndVerify(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'e2e-owner@example.com', password: 'password123', name: 'E2E' }),
  });
  const { token } = await json<{ token: string }>(signup);
  const auth = { ...guestHeaders, Authorization: `Bearer ${token}` };
  const credits = async () =>
    json<CreditsReport>(await fetch(`${base}/api/usage/credits`, { headers: auth }));
  assert.equal(
    (await credits()).balance,
    TRIAL_CREDITS,
    'бесплатный анализ не тронул пробные кредиты',
  );
  const claimed = await getView(auth);
  assert.equal(claimed.analysis.status, 'ready');

  // 5. Подробный план за кредиты: без согласия — цена; с согласием — списание по факту.
  const paidPath = `${base}/api/analyses/${id}/opportunities/${byTitle('Скрипт через API')}/plan`;
  const unconfirmed = await fetch(paidPath, { method: 'POST', headers: auth, body: '{}' });
  assert.equal(unconfirmed.status, 409);
  const quoted = await json<{ error: { details: { maxCredits: number } } }>(unconfirmed);
  const paid = await fetch(paidPath, { method: 'POST', headers: auth, body: '{"confirm":true}' });
  assert.equal(paid.status, 202);
  const paidId = (await json<{ plan: { id: string } }>(paid)).plan.id;
  const fullPlan = await until(async () => {
    const body = await json<{
      plan: { status: string; kind: string; cost: { chargedCredits: number } };
    }>(await fetch(`${base}/api/analyses/${id}/plans/${paidId}`, { headers: auth }));
    return body.plan.status === 'ready' ? body.plan : null;
  }, 'подробный план');
  assert.equal(fullPlan.kind, 'full');
  assert.equal(fullPlan.cost.chargedCredits, 3, 'списана цена провайдера: $0.003 = 3 кредита');
  assert.ok(fullPlan.cost.chargedCredits <= quoted.error.details.maxCredits);
  assert.equal((await credits()).balance, TRIAL_CREDITS - 3);
  assert.equal(calls.at(-1), 'xiaomi/mimo-v2.6-pro');

  // 6. Оплата пакета в тестовом режиме: кредиты добавляются.
  const pack = CREDIT_PACKS[0]!;
  const checkout = await fetch(`${base}/api/billing/checkout`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ packId: pack.id }),
  });
  assert.equal(checkout.status, 200);
  const afterPayment = await credits();
  assert.equal(afterPayment.balance, TRIAL_CREDITS - 3 + pack.credits);
  assert.equal(afterPayment.purchased, true);

  // 7. Помощник из возможности: черновик за кредиты, проверка, включение, чат.
  const solution = await fetch(`${base}/api/solutions/from-opportunity`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      analysisId: id,
      opportunityId: byTitle('Черновики ответов'),
      confirm: true,
    }),
  });
  assert.equal(solution.status, 201);
  const solutionId = (await json<{ solution: { id: string } }>(solution)).solution.id;
  const run = await fetch(`${base}/api/solutions/${solutionId}/test-runs`, {
    method: 'POST',
    headers: auth,
    body: '{"confirm":true}',
  });
  assert.equal(run.status, 202);
  const tested = await until(async () => {
    const body = await json<{ run: { status: string } | null; readiness: { ready: boolean } }>(
      await fetch(`${base}/api/solutions/${solutionId}`, { headers: auth }),
    );
    return body.run?.status === 'done' ? body : null;
  }, 'проверка помощника');
  assert.equal(tested.readiness.ready, true);
  const activated = await fetch(`${base}/api/solutions/${solutionId}/activate`, {
    method: 'POST',
    headers: auth,
  });
  assert.equal(activated.status, 200);
  const thread = await json<{ thread: { id: string } }>(
    await fetch(`${base}/api/solutions/${solutionId}/threads`, { method: 'POST', headers: auth }),
  );
  const before = (await credits()).balance;
  const chat = await fetch(
    `${base}/api/solutions/${solutionId}/threads/${thread.thread.id}/messages`,
    {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ content: 'Сколько ехать заказу?' }),
    },
  );
  const stream = await chat.text();
  assert.match(stream, /Доставка занимает 3 дня/);
  assert.match(stream, /event: done/);
  assert.equal((await credits()).balance, before - 3, 'ответ помощника списан как сообщение чата');

  // 8. Общий чат закрыт (product-switches.ts): сервер отказывает, весь путь выше прошёл без него.
  for (const [path, body] of [
    ['/api/conversations', { title: 'Проверка' }],
    ['/api/chat/completions', { modelId: 'auto', messages: [{ role: 'user', content: 'Привет' }] }],
  ] as const) {
    const closed = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(body),
    });
    assert.equal(closed.status, 503, path);
    const error = (await closed.json()) as {
      error: { code: string; details: { feature: string } };
    };
    assert.equal(error.error.code, 'feature_unavailable');
    assert.equal(error.error.details.feature, 'chat');
  }
});
