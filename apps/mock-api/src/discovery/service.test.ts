import assert from 'node:assert/strict';
import test from 'node:test';
import type { GatewayRequest, GatewayStreamCallbacks } from '../ai/gateway-types.js';
import { MemoryBudgetStore } from './budget.js';
import { stagePolicy } from './model-policy.js';
import { DiscoveryService, chargedCredits, type DiscoveryCaller } from './service.js';
import { MemoryDiscoveryStore } from './store.js';

const SHORT = 'Веду интернет-магазин, много однотипных вопросов от покупателей.';
const LONG =
  `${SHORT} Отвечаю примерно 40 раз в неделю по 10 минут. Данные в таблицах, CRM нет. `.repeat(3);

const CONTEXT_WITH_QUESTIONS = JSON.stringify({
  domain: 'Интернет-магазин',
  summary: 'Много однотипных вопросов',
  tasks: [
    {
      id: 't1',
      title: 'Ответы покупателям',
      timesPerWeek: null,
      minutesEach: null,
      source: 'user',
    },
  ],
  questions: [
    {
      id: 'q1',
      text: 'Где сейчас хранятся заказы?',
      reason: 'Интеграции',
      optional: false,
      kind: 'text',
    },
    {
      id: 'q2',
      text: 'Сколько вопросов в неделю?',
      reason: 'Польза',
      optional: true,
      kind: 'text',
    },
  ],
});
const CONTEXT_NO_QUESTIONS = JSON.stringify({
  domain: 'Интернет-магазин',
  summary: 'Много однотипных вопросов',
  tasks: [
    {
      id: 't1',
      title: 'Ответы покупателям',
      timesPerWeek: 40,
      minutesEach: 10,
      evidence: 'Отвечаю примерно 40 раз в неделю по 10 минут',
      source: 'user',
    },
  ],
});
const DISCOVERY = JSON.stringify({
  summary: 'Больше всего поможет ИИ в ответах покупателям.',
  opportunities: [
    {
      title: 'Автоответы в почте',
      problem: 'Однотипные письма',
      solution: 'ИИ отвечает сам',
      requires: ['email', 'text_generation'],
      effort: 'high',
      impact: { taskId: 't1', automationShare: 'high', benefit: 'Меньше ручных ответов' },
    },
    {
      title: 'Черновики ответов',
      problem: 'Однотипные вопросы',
      solution: 'ИИ пишет черновик, вы проверяете',
      requires: ['text_generation'],
      effort: 'low',
      impact: { taskId: 't1', automationShare: 'medium', benefit: 'Быстрее отвечать' },
    },
    {
      title: 'Свой скрипт через API',
      problem: 'Ручное копирование',
      solution: 'Скрипт вызывает модель',
      requires: ['api_access'],
      effort: 'medium',
      impact: { taskId: null, automationShare: 'low', benefit: 'Меньше копирования' },
    },
  ],
});

interface Script {
  context?: string;
  discovery?: string;
  failDiscovery?: number;
  costUsd?: number;
  creditsUsd?: number;
}

function fakeGateway(script: Script) {
  const requests: GatewayRequest[] = [];
  let discoveryFailures = script.failDiscovery ?? 0;
  return {
    requests,
    gateway: {
      async stream(request: GatewayRequest, callbacks: GatewayStreamCallbacks) {
        requests.push(request);
        const stage = request.task?.id.split(':')[1];
        if (stage === 'discovery' && discoveryFailures > 0) {
          discoveryFailures -= 1;
          callbacks.onError({ code: 'provider_error', message: 'Модель недоступна' });
          return;
        }
        const text =
          stage === 'context'
            ? (script.context ?? CONTEXT_WITH_QUESTIONS)
            : (script.discovery ?? DISCOVERY);
        callbacks.onDelta(text);
        callbacks.onDone({
          inputTokens: 100,
          outputTokens: 100,
          source: 'provider',
          finishReason: 'stop',
          canContinue: false,
          selectedModel: { id: request.modelId, name: request.modelId },
          costUsd: script.costUsd ?? 0.002,
          creditsUsd: request.task?.billing === 'sponsored' ? 0 : (script.creditsUsd ?? 0.004),
        });
      },
    },
  };
}

function setup(
  options: { script?: Script; freeDailyUsd?: number; balanceUsd?: number; now?: () => Date } = {},
) {
  const store = new MemoryDiscoveryStore();
  const budget = new MemoryBudgetStore();
  const fake = fakeGateway(options.script ?? {});
  const service = new DiscoveryService({
    store,
    budget,
    gateway: fake.gateway,
    balanceUsd: () => options.balanceUsd ?? 0,
    userCapabilities: () => ({ hasPurchasedCredits: false, githubConnected: false }),
    freeDailyUsd: options.freeDailyUsd ?? 5,
    budgetTimeZone: 'UTC',
    ...(options.now ? { now: options.now } : {}),
  });
  return { store, budget, service, requests: fake.requests };
}

let guestSeq = 0;
function guest(ipHash = `ip-${Math.random()}`): DiscoveryCaller {
  guestSeq += 1;
  return {
    userId: `guest_tester${String(guestSeq).padStart(4, '0')}`,
    plan: 'free',
    isVip: false,
    anonymous: true,
    guest: true,
    ipHash,
    ipLimited: true,
  };
}

function account(id: string, options: Partial<DiscoveryCaller> = {}): DiscoveryCaller {
  return {
    userId: id,
    plan: 'credits',
    isVip: false,
    anonymous: false,
    guest: false,
    ipHash: `ip-${id}`,
    ipLimited: false,
    ...options,
  };
}

const create = (
  service: DiscoveryService,
  caller: DiscoveryCaller,
  extra: Partial<Parameters<DiscoveryService['create']>[0]> = {},
) =>
  service.create({
    caller,
    email: null,
    text: SHORT,
    language: 'ru',
    idempotencyKey: null,
    ...extra,
  });

test('бесплатный сценарий гостя: разбор → вопросы → ответы → возможности; платит сервис из бюджета', async () => {
  const { service, budget, requests } = setup();
  const caller = guest();
  const created = await create(service, caller);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.analysis.status, 'analyzing');
  await service.whenIdle();

  // Резервы: разбор, поиск, план — по потолкам этапов.
  const reserved = await budget.forAnalysis(created.analysis.id);
  assert.deepEqual(reserved.map((item) => item.stage).sort(), ['context', 'discovery', 'plan']);
  assert.equal(
    reserved.find((item) => item.stage === 'plan')?.capUsd,
    stagePolicy('free', 'plan', 'ru').capUsd,
  );

  let view = await service.get(caller.userId, created.analysis.id);
  assert.equal(view?.analysis.status, 'needs_answers');
  assert.equal(view?.analysis.questions.length, 2);
  // Разбор закрыт по факту: потрачено 0.002, а не потолок.
  const contextReservation = (await budget.forAnalysis(created.analysis.id)).find(
    (item) => item.stage === 'context',
  );
  assert.equal(contextReservation?.status, 'settled');
  assert.equal(contextReservation?.actualUsd, 0.002);

  // Обязательный вопрос без ответа — нельзя; необязательный можно пропустить.
  const missing = await service.continue(caller, created.analysis.id, { answers: {} });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, 'answers_required');
  const continued = await service.continue(caller, created.analysis.id, {
    answers: { q1: { value: 'В таблице Google' } },
  });
  assert.equal(continued.ok, true);
  await service.whenIdle();

  view = await service.get(caller.userId, created.analysis.id);
  assert.equal(view?.analysis.status, 'ready');
  assert.deepEqual(view?.analysis.answers, {
    q1: { value: 'В таблице Google' },
    q2: { skipped: true },
  });
  assert.equal(view?.analysis.summary, 'Больше всего поможет ИИ в ответах покупателям.');
  // Ответы ушли модели в поиске возможностей.
  assert.match(requests.at(-1)?.messages[0].content ?? '', /В таблице Google/);

  // Статусы считает код; порядок: готовое → настройка → не поддерживается.
  const ordered = [...(view?.opportunities ?? [])].sort((a, b) => a.priority - b.priority);
  assert.deepEqual(
    ordered.map((item) => [item.title, item.feasibilityStatus]),
    [
      ['Черновики ответов', 'ready'],
      ['Свой скрипт через API', 'needs_setup'],
      ['Автоответы в почте', 'not_supported'],
    ],
  );
  // Чисел в описании нет — польза словами.
  assert.ok(ordered.every((item) => item.impact.kind === 'qualitative'));
  assert.equal(chargedCredits(view!.analysis), 0);
  // Все вызовы — бесплатные (sponsored), на GPT-6 Luna, без подмены модели.
  assert.ok(
    requests.every(
      (request) => request.task?.billing === 'sponsored' && request.modelId === 'ketner-mini',
    ),
  );
  assert.ok(requests.every((request) => request.strictModel === true));
  // План ещё не запускался: его резерв держится.
  assert.equal(
    (await budget.forAnalysis(created.analysis.id)).find((item) => item.stage === 'plan')?.status,
    'held',
  );
});

test('без вопросов поиск возможностей идёт сразу; часы — по числам из текста пользователя', async () => {
  const { service } = setup({ script: { context: CONTEXT_NO_QUESTIONS } });
  const caller = guest();
  const created = await create(service, caller, { text: LONG });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await service.whenIdle();
  const view = await service.get(caller.userId, created.analysis.id);
  assert.equal(view?.analysis.status, 'ready');
  const drafts = view?.opportunities.find((item) => item.title === 'Черновики ответов');
  assert.equal(drafts?.impact.kind, 'estimate');
  if (drafts?.impact.kind === 'estimate') {
    // 40 × 10 мин = 400 мин/нед; 30–60% → 2–4 ч.
    assert.deepEqual(drafts.impact.hoursPerWeek, [2, 4]);
  }
});

test('один бесплатный анализ в сутки: второй — понятный отказ с ценой анализа за кредиты', async () => {
  const { service } = setup();
  const caller = guest();
  assert.equal((await create(service, caller)).ok, true);
  const second = await create(service, caller);
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.status, 409);
  assert.equal(second.code, 'free_unavailable');
  assert.equal(second.details?.reason, 'daily_limit');
  assert.equal(second.details?.loginRequired, true);
  const paid = second.details?.paid as {
    model: string;
    typicalCredits: number;
    maxCredits: number;
  };
  assert.equal(paid.model, 'MiMo-V2.6 Pro');
  assert.ok(paid.typicalCredits > 0 && paid.maxCredits >= paid.typicalCredits);
  assert.match(String(second.details?.resetsAt), /T00:00:00\.000Z$/);
});

test('защита от множества аккаунтов: не больше 5 бесплатных в сутки с адреса для гостей и новых аккаунтов', async () => {
  const { service } = setup();
  for (let index = 0; index < 5; index += 1) {
    assert.equal((await create(service, guest('shared-ip'))).ok, true);
  }
  const sixth = await create(service, guest('shared-ip'));
  assert.equal(sixth.ok, false);
  if (!sixth.ok) assert.equal(sixth.details?.reason, 'ip_limit');
  // Старый аккаунт с того же адреса (мобильный оператор) не ограничивается по адресу.
  const old = await create(service, account('old-user', { ipHash: 'shared-ip', plan: 'free' }));
  assert.equal(old.ok, true);
  // Одноразовая почта — без бесплатного анализа.
  const disposable = await service.create({
    caller: account('temp-user', { plan: 'free' }),
    email: 'x@mailinator.com',
    text: SHORT,
    language: 'ru',
    idempotencyKey: null,
  });
  assert.equal(disposable.ok, false);
  if (!disposable.ok) assert.equal(disposable.details?.reason, 'disposable_email');
});

test('бюджет $5 исчерпан: новые бесплатные анализы не стартуют, параллельные запросы не превышают лимит', async () => {
  const capOfScenario = ['context', 'discovery', 'plan'].reduce(
    (sum, stage) => sum + stagePolicy('free', stage as 'context', 'ru').capUsd,
    0,
  );
  // Бюджет ровно на 3 сценария по потолку.
  const { service, budget } = setup({ freeDailyUsd: Math.round(capOfScenario * 3.5 * 1e6) / 1e6 });
  const results = await Promise.all(Array.from({ length: 10 }, () => create(service, guest())));
  assert.equal(results.filter((item) => item.ok).length, 3);
  const refused = results.find((item) => !item.ok);
  assert.ok(refused && !refused.ok && refused.details?.reason === 'budget_exhausted');
  assert.match(
    refused && !refused.ok ? refused.message : '',
    /Бесплатные анализы на сегодня закончились/,
  );
  const day = await budget.day(service.today());
  assert.ok(day && day.spentUsd + day.reservedUsd <= day.limitUsd);
  await service.whenIdle();
});

test('бюджет сбрасывается со сменой суток', async () => {
  let now = new Date('2026-10-30T23:50:00.000Z');
  const capOfScenario = ['context', 'discovery', 'plan'].reduce(
    (sum, stage) => sum + stagePolicy('free', stage as 'context', 'ru').capUsd,
    0,
  );
  const { service } = setup({
    freeDailyUsd: Math.round(capOfScenario * 1.2 * 1e6) / 1e6,
    now: () => now,
  });
  assert.equal((await create(service, guest())).ok, true);
  const refused = await create(service, guest());
  assert.equal(refused.ok, false);
  now = new Date('2026-10-31T00:05:00.000Z');
  assert.equal((await create(service, guest())).ok, true);
  await service.whenIdle();
});

test('анализ за кредиты: гостю — вход, без баланса — отказ с суммой, иначе списание по факту', async () => {
  const poor = setup({ balanceUsd: 0.001 });
  const asGuest = await create(poor.service, guest(), { mode: 'paid' });
  assert.equal(asGuest.ok, false);
  if (!asGuest.ok) assert.equal(asGuest.code, 'login_required');
  const noMoney = await create(poor.service, account('poor'), { mode: 'paid' });
  assert.equal(noMoney.ok, false);
  if (!noMoney.ok) {
    assert.equal(noMoney.status, 402);
    assert.equal(noMoney.code, 'insufficient_credits');
    assert.equal(noMoney.details?.balanceCredits, 1);
  }

  const rich = setup({
    balanceUsd: 10,
    script: { context: CONTEXT_NO_QUESTIONS, creditsUsd: 0.0044 },
  });
  const caller = account('rich');
  const created = await create(rich.service, caller, { mode: 'paid' });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await rich.service.whenIdle();
  const view = await rich.service.get(caller.userId, created.analysis.id);
  assert.equal(view?.analysis.status, 'ready');
  // Списано по факту: два вызова по 0.0044 → 8.8 кредита.
  assert.equal(chargedCredits(view!.analysis), 8.8);
  assert.ok(
    rich.requests.every(
      (request) => request.task?.billing === 'user' && request.modelId === 'ketner-pro',
    ),
  );
  // Бесплатный бюджет не тронут.
  assert.equal(await rich.budget.day(rich.service.today()), null);
});

test('«Глубокий анализ» на Claude Sonnet 5.5 — только с подтверждением суммы', async () => {
  const { service, requests } = setup({
    balanceUsd: 10,
    script: { context: CONTEXT_NO_QUESTIONS },
  });
  const caller = account('deep-user');
  const unconfirmed = await create(service, caller, { mode: 'deep' });
  assert.equal(unconfirmed.ok, false);
  if (!unconfirmed.ok) {
    assert.equal(unconfirmed.code, 'confirmation_required');
    assert.ok(Number(unconfirmed.details?.maxCredits) > 50);
  }
  const confirmed = await create(service, caller, { mode: 'deep', confirm: true });
  assert.equal(confirmed.ok, true);
  await service.whenIdle();
  assert.ok(requests.every((request) => request.modelId === 'claude-sonnet-5.5'));
  assert.ok(requests.every((request) => request.task?.reasoningEffort === 'medium'));
});

test('этап упал: статус failed с причиной, повтор берёт новый резерв и доводит анализ', async () => {
  const { service, budget } = setup({
    script: { context: CONTEXT_NO_QUESTIONS, failDiscovery: 1 },
  });
  const caller = guest();
  const created = await create(service, caller);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await service.whenIdle();
  let view = await service.get(caller.userId, created.analysis.id);
  assert.equal(view?.analysis.status, 'failed');
  assert.equal(view?.analysis.stages.discovery?.error?.code, 'provider_error');
  // Упавший вызов без счёта провайдера — ноль в бюджете.
  const failed = (await budget.forAnalysis(created.analysis.id)).find(
    (item) => item.stage === 'discovery' && item.status === 'settled',
  );
  assert.equal(failed?.actualUsd, 0);

  const retried = await service.retry(caller, created.analysis.id);
  assert.equal(retried.ok, true);
  await service.whenIdle();
  view = await service.get(caller.userId, created.analysis.id);
  assert.equal(view?.analysis.status, 'ready');
  assert.equal(view?.opportunities.length, 3);
});

test('этап, зависший после перезапуска сервера, становится прерванным и повторяемым', async () => {
  let now = new Date('2026-10-30T10:00:00.000Z');
  const { service, store } = setup({ now: () => now });
  const caller = guest();
  const created = await create(service, caller);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await service.whenIdle();
  // Имитируем перезапуск посреди этапа: этап «выполняется», фоновой задачи нет.
  const stored = (await store.get(caller.userId, created.analysis.id))!;
  await store.update(
    {
      ...stored,
      status: 'discovering',
      stages: {
        ...stored.stages,
        discovery: { ...stored.stages.discovery!, status: 'running', startedAt: now.toISOString() },
      },
    },
    stored.version,
  );
  now = new Date('2026-10-30T10:20:00.000Z');
  const view = await service.get(caller.userId, created.analysis.id);
  assert.equal(view?.analysis.status, 'failed');
  assert.equal(view?.analysis.stages.discovery?.error?.code, 'interrupted');
});

test('повтор запроса с тем же Idempotency-Key возвращает тот же анализ и не резервирует бюджет второй раз', async () => {
  const { service, budget } = setup();
  const caller = guest();
  const first = await create(service, caller, { idempotencyKey: 'retry-key-123' });
  const second = await create(service, caller, { idempotencyKey: 'retry-key-123' });
  assert.ok(first.ok && second.ok);
  if (!first.ok || !second.ok) return;
  assert.equal(second.duplicate, true);
  assert.equal(second.analysis.id, first.analysis.id);
  const day = await budget.day(service.today());
  const once = ['context', 'discovery', 'plan'].reduce(
    (sum, stage) => sum + stagePolicy('free', stage as 'context', 'ru').capUsd,
    0,
  );
  assert.ok(day && Math.abs(day.spentUsd + day.reservedUsd - once) < 0.0001 + 0.002 * 2);
  await service.whenIdle();
});

test('чужой анализ не виден и не продолжается', async () => {
  const { service } = setup();
  const owner = guest();
  const created = await create(service, owner);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await service.whenIdle();
  const stranger = guest();
  assert.equal(await service.get(stranger.userId, created.analysis.id), null);
  const result = await service.continue(stranger, created.analysis.id, { answers: {} });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
});

test('черновик ответов сохраняется без вызова модели и переживает перезагрузку', async () => {
  const { service, requests } = setup();
  const caller = guest();
  const created = await create(service, caller);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await service.whenIdle();
  const calls = requests.length;

  const saved = await service.saveAnswers(caller, created.analysis.id, {
    q1: { value: 'В Excel' },
    q2: { skipped: true },
    zz: { value: 'чужой вопрос отбрасывается' },
  });
  assert.equal(saved.ok, true);
  const view = await service.get(caller.userId, created.analysis.id);
  assert.deepEqual(view?.analysis.answers, { q1: { value: 'В Excel' }, q2: { skipped: true } });
  assert.equal(view?.analysis.status, 'needs_answers');
  assert.equal(requests.length, calls, 'модель не вызывалась');

  // Правка черновика — тоже без модели.
  await service.saveAnswers(caller, created.analysis.id, { q1: { value: 'В Google Таблицах' } });
  const edited = await service.get(caller.userId, created.analysis.id);
  assert.deepEqual(edited?.analysis.answers, { q1: { value: 'В Google Таблицах' } });
  assert.equal(requests.length, calls);

  // Чужой черновик не меняется.
  const stranger = await service.saveAnswers(guest(), created.analysis.id, { q1: { value: 'x' } });
  assert.equal(stranger.ok, false);
  if (!stranger.ok) assert.equal(stranger.status, 404);

  // После запуска поиска черновик не принимается.
  await service.continue(caller, created.analysis.id, { answers: { q1: { value: 'В Excel' } } });
  await service.whenIdle();
  const late = await service.saveAnswers(caller, created.analysis.id, { q1: { value: 'y' } });
  assert.equal(late.ok, false);
  if (!late.ok) assert.equal(late.code, 'analysis_not_waiting');
});

test('после отчёта: те же ответы — модель не вызывается; изменённые — повторный поиск за кредиты с согласием', async () => {
  const { service, budget, requests } = setup({ balanceUsd: 1 });
  const caller = account('user-rerun');
  const created = await create(service, caller);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await service.whenIdle();
  await service.continue(caller, created.analysis.id, { answers: { q1: { value: 'В Excel' } } });
  await service.whenIdle();
  const id = created.analysis.id;
  const before = await service.get(caller.userId, id);
  assert.equal(before?.analysis.status, 'ready');
  const firstOpportunityIds = before?.opportunities.map((item) => item.id);
  const calls = requests.length;
  const budgetBefore = await budget.day(service.today());

  // Те же ответы (пробелы и явный пропуск необязательного не в счёт) — ничего не запускается.
  const variants: Array<Record<string, { value: string } | { skipped: true }>> = [
    { q1: { value: 'В Excel' } },
    { q1: { value: '  В Excel ' }, q2: { skipped: true } },
  ];
  for (const answers of variants) {
    const same = await service.continue(caller, id, { answers, confirm: true });
    assert.equal(same.ok, true);
    if (same.ok) assert.equal(same.rerun, false);
  }
  assert.equal(requests.length, calls);

  // Изменённые ответы без согласия — цена и отказ, модель не вызывается.
  const unconfirmed = await service.continue(caller, id, {
    answers: { q1: { value: 'В 1С' } },
  });
  assert.equal(unconfirmed.ok, false);
  if (!unconfirmed.ok) {
    assert.equal(unconfirmed.code, 'confirmation_required');
    const quote = service.rerunQuote(before!.analysis, caller);
    assert.equal(unconfirmed.details?.maxCredits, quote.maxCredits);
    assert.equal(quote.model, 'GPT-6 Luna');
  }
  assert.equal(requests.length, calls);

  // С согласием — один повторный поиск той же моделью, за кредиты, не из бюджета бесплатных.
  const [rerun, doubleClick] = await Promise.all([
    service.continue(caller, id, { answers: { q1: { value: 'В 1С' } }, confirm: true }),
    service.continue(caller, id, { answers: { q1: { value: 'В 1С' } }, confirm: true }),
  ]);
  assert.equal(rerun.ok && doubleClick.ok, true);
  if (rerun.ok && doubleClick.ok) assert.equal(Number(rerun.rerun) + Number(doubleClick.rerun), 1);
  await service.whenIdle();
  assert.equal(requests.length, calls + 1);
  const last = requests.at(-1);
  assert.equal(last?.task?.billing, 'user');
  assert.equal(last?.modelId, 'ketner-mini');
  assert.equal(last?.task?.id, `${id}:discovery:2`);
  assert.match(last?.messages[0].content ?? '', /В 1С/);
  assert.deepEqual(await budget.day(service.today()), budgetBefore, 'бюджет бесплатных не тронут');

  const after = await service.get(caller.userId, id);
  assert.equal(after?.analysis.status, 'ready');
  assert.deepEqual(after?.analysis.answers.q1, { value: 'В 1С' });
  assert.equal(chargedCredits(after!.analysis), 4);
  assert.notDeepEqual(
    after?.opportunities.map((item) => item.id),
    firstOpportunityIds,
    'возможности пересчитаны',
  );
});

test('изменить ответы после отчёта: гостю — вход, без баланса — отказ; упавший повторный поиск повторяется за кредиты', async () => {
  const guestCaller = guest();
  const first = setup();
  const created = await create(first.service, guestCaller);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await first.service.whenIdle();
  await first.service.continue(guestCaller, created.analysis.id, {
    answers: { q1: { value: 'A' } },
  });
  await first.service.whenIdle();
  const asGuest = await first.service.continue(guestCaller, created.analysis.id, {
    answers: { q1: { value: 'B' } },
    confirm: true,
  });
  assert.equal(asGuest.ok, false);
  if (!asGuest.ok) assert.equal(asGuest.code, 'login_required');

  // Без баланса — отказ с суммой.
  const poor = setup({ balanceUsd: 0 });
  const user = account('user-poor');
  const made = await create(poor.service, user);
  if (!made.ok) return assert.fail('анализ не создан');
  await poor.service.whenIdle();
  await poor.service.continue(user, made.analysis.id, { answers: { q1: { value: 'A' } } });
  await poor.service.whenIdle();
  const noMoney = await poor.service.continue(user, made.analysis.id, {
    answers: { q1: { value: 'B' } },
    confirm: true,
  });
  assert.equal(noMoney.ok, false);
  if (!noMoney.ok) assert.equal(noMoney.code, 'insufficient_credits');

  // Повторный поиск упал — повтор идёт снова за кредиты, без резерва бесплатного бюджета.
  const flaky = setup({ balanceUsd: 1, script: {} });
  const owner = account('user-flaky');
  const analysis = await create(flaky.service, owner);
  if (!analysis.ok) return assert.fail('анализ не создан');
  await flaky.service.whenIdle();
  await flaky.service.continue(owner, analysis.analysis.id, { answers: { q1: { value: 'A' } } });
  await flaky.service.whenIdle();
  const reservationsBefore = (await flaky.budget.forAnalysis(analysis.analysis.id)).length;
  // Повторный поиск после изменения ответов упал (как его записал бы failStage).
  const stored = await flaky.store.get(owner.userId, analysis.analysis.id);
  assert.ok(stored);
  await flaky.store.update(
    {
      ...stored!,
      status: 'failed',
      answers: { q1: { value: 'B' }, q2: { skipped: true } },
      stages: {
        ...stored!.stages,
        discovery: {
          ...stored!.stages.discovery!,
          status: 'failed',
          taskId: `${analysis.analysis.id}:discovery:2`,
          billing: 'user',
          error: { code: 'provider_error', message: 'Модель недоступна' },
        },
      },
    },
    stored!.version,
  );
  const failedView = await flaky.service.get(owner.userId, analysis.analysis.id);
  assert.deepEqual(flaky.service.retryQuote(failedView!.analysis, owner), {
    stage: 'discovery',
    sponsored: false,
    model: 'GPT-6 Luna',
    ...(({ typicalCredits, maxCredits }) => ({ typicalCredits, maxCredits }))(
      flaky.service.rerunQuote(failedView!.analysis, owner),
    ),
    loginRequired: false,
  });
  const retried = await flaky.service.retry(owner, analysis.analysis.id);
  assert.equal(retried.ok, true);
  await flaky.service.whenIdle();
  assert.equal((await flaky.budget.forAnalysis(analysis.analysis.id)).length, reservationsBefore);
  const call = flaky.requests.at(-1);
  assert.equal(call?.task?.billing, 'user');
  assert.equal(call?.task?.id, `${analysis.analysis.id}:discovery:3`);
  const done = await flaky.service.get(owner.userId, analysis.analysis.id);
  assert.equal(done?.analysis.status, 'ready');
});

test('бюджет меньше одного сценария: предложение сразу говорит, что бесплатного анализа нет', async () => {
  const { service } = setup({ freeDailyUsd: 0.001 });
  const offer = await service.offer(guest(), 'ru');
  assert.equal(offer.free.available, false);
  if (!offer.free.available) assert.equal(offer.free.reason, 'budget_exhausted');
});

test('«Сохранить анализ» — только в аккаунте; удаление стирает анализ, но не обнуляет лимит', async () => {
  const { service, budget, store } = setup();
  const visitor = guest();
  const created = await create(service, visitor);
  if (!created.ok) return assert.fail('анализ не создан');
  const id = created.analysis.id;

  // Пока этап идёт — удалить нельзя.
  const busy = await service.remove(visitor, id);
  assert.equal(busy.ok, false);
  if (!busy.ok) assert.equal(busy.code, 'analysis_busy');
  await service.whenIdle();

  const asGuest = await service.setSaved(visitor, id, true);
  assert.equal(asGuest.ok, false);
  if (!asGuest.ok) assert.equal(asGuest.code, 'login_required');

  // После входа анализ переходит в аккаунт и сохраняется.
  const user = account('user-saver');
  assert.equal(await service.claimGuest(user.userId, visitor.userId, id), true);
  const saved = await service.setSaved(user, id, true);
  assert.equal(saved.ok && saved.analysis.saved, true);
  const stranger = await service.setSaved(account('user-stranger'), id, true);
  assert.equal(stranger.ok, false);
  if (!stranger.ok) assert.equal(stranger.status, 404);

  // Удаление: чужой — 404; своё — анализ пропал, резерв плана вернулся в бюджет.
  assert.equal((await service.remove(account('user-stranger'), id)).ok, false);
  const removed = await service.remove(user, id);
  assert.equal(removed.ok, true);
  assert.equal(await service.get(user.userId, id), null);
  const plan = (await budget.forAnalysis(id)).find((item) => item.stage === 'plan');
  assert.equal(plan?.status, 'released');
  // Бесплатный анализ дня уже использован — удаление его не возвращает.
  assert.equal(
    await store.count({ ownerId: user.userId, budgetDay: service.today(), mode: 'free' }),
    1,
  );
});
