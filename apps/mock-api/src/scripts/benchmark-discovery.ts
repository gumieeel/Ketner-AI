/**
 * Замер качества моделей анализа (этап 9, docs/ACCEPTANCE.md).
 *
 * Прогоняет 20 типичных задач на русском через настоящий DiscoveryService — те же промпты, схемы,
 * повторную попытку при невалидном JSON, проверку чисел и выполнимости, что и на сайте, — и
 * считает метрики по каждой задаче и в целом:
 *   - валидный JSON с первой попытки (контекст, поиск возможностей, план);
 *   - сколько возможностей и какая выполнимость (готово / настроить / подключить / не поддерживается);
 *   - честность чисел: у задач, где пользователь назвал частоту и минуты, есть расчёт экономии;
 *     у задач без чисел расчёта нет (модель не выдумала часы);
 *   - себестоимость и время.
 *
 * Запуск (нужен ключ OpenRouter; кредиты пользователей не трогаются, тратится баланс ключа):
 *   OPENROUTER_API_KEY=... npm run bench:discovery -- --mode free
 *   npm run bench:discovery -- --mode paid --limit 5 --out bench.json
 *   npm run bench:discovery -- --dry          # без ключа: проверка самого замера на шаблонах
 *
 * Режимы: free — GPT-6 Luna, paid — MiMo-V2.6 Pro, deep — Claude Sonnet 5.5 (docs/discovery-models.md).
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { AIGateway } from '../ai/gateway.js';
import type { GatewayRequest, GatewayStreamCallbacks } from '../ai/gateway-types.js';
import { config } from '../config.js';
import { MemoryBudgetStore } from '../discovery/budget.js';
import type { AnalysisMode } from '../discovery/model-policy.js';
import { DiscoveryService, type DiscoveryCaller } from '../discovery/service.js';
import { MemoryDiscoveryStore } from '../discovery/store.js';
import { contextTemplate, discoveryTemplate, planTemplate } from '../discovery/templates.js';
import type { Analysis, Opportunity, Plan } from '../discovery/types.js';
import { UsageStore } from '../store/usage-store.js';

export interface BenchTask {
  id: string;
  text: string;
  /** Ответ на уточняющие вопросы (одинаковый на все: как ответил бы занятой человек). */
  answer: string;
  /** В тексте есть частота и длительность задачи — ждём расчёт экономии в часах. */
  numbers: boolean;
}

/** 20 типичных запросов: разные сферы, с числами и без, простые и требующие интеграций. */
export const BENCH_TASKS: readonly BenchTask[] = [
  {
    id: 'shop-support',
    text: 'Веду интернет-магазин одежды. Каждый день отвечаю покупателям в Директе на одни и те же вопросы: размеры, доставка, возврат. Это примерно 40 сообщений в день, на каждое уходит минуты 3.',
    answer: 'Заказы в Google Таблицах, переписка в Instagram.',
    numbers: true,
  },
  {
    id: 'accountant-docs',
    text: 'Я бухгалтер на аутсорсе у 12 маленьких компаний. Клиенты присылают фото чеков и накладных, я вручную переношу суммы в 1С. Раз в неделю по каждому клиенту трачу часа два.',
    answer: '1С облачная, документы приходят в Telegram.',
    numbers: true,
  },
  {
    id: 'teacher-tests',
    text: 'Преподаю историю в школе, 6 классов. Хочу быстрее готовить проверочные и разные варианты заданий, а ещё проверять эссе.',
    answer: 'Работаю в Google Документах.',
    numbers: false,
  },
  {
    id: 'realtor-listings',
    text: 'Риелтор. Пишу описания квартир для Авито и Циана, по 10 объявлений в неделю, на каждое около 30 минут, плюс подбираю фото.',
    answer: 'Объекты в Excel, публикую вручную.',
    numbers: true,
  },
  {
    id: 'hr-screening',
    text: 'Я HR в IT-компании на 150 человек. Получаем сотни откликов на вакансии, первичный отбор резюме съедает весь день. Ещё пишу письма кандидатам.',
    answer: 'Отклики на hh.ru, кандидаты в Хантфлоу.',
    numbers: false,
  },
  {
    id: 'cafe-marketing',
    text: 'Владею кофейней. Не успеваю вести соцсети: посты, сторис, ответы на отзывы на Яндекс Картах.',
    answer: 'ВКонтакте и Telegram-канал, отзывы на Яндексе.',
    numbers: false,
  },
  {
    id: 'lawyer-contracts',
    text: 'Юрист в небольшой фирме. Проверяю договоры поставки на риски, каждый день 3–4 договора, по часу на каждый.',
    answer: 'Договоры в Word, присылают по почте.',
    numbers: true,
  },
  {
    id: 'dev-reviews',
    text: 'Тимлид, команда из 5 разработчиков на TypeScript. Много времени уходит на ревью пулл-реквестов и написание тестов.',
    answer: 'Код на GitHub, CI в GitHub Actions.',
    numbers: false,
  },
  {
    id: 'logistics-calls',
    text: 'Диспетчер в транспортной компании. Обзваниваю водителей и клиентов по статусу доставки, около 60 звонков в день, по 4 минуты.',
    answer: 'Заявки в amoCRM, звоню с мобильного.',
    numbers: true,
  },
  {
    id: 'student-thesis',
    text: 'Студентка 4 курса, пишу диплом по маркетингу. Нужно разобраться с литературой, структурой и анализом опросов.',
    answer: 'Опрос в Google Формах, около 200 ответов.',
    numbers: false,
  },
  {
    id: 'clinic-admin',
    text: 'Администратор стоматологии. Записываю пациентов, напоминаю о приёме, отвечаю на вопросы о ценах. Напоминания — 30 в день, по 2 минуты.',
    answer: 'Запись в программе ИДЕНТ, пишем в WhatsApp.',
    numbers: true,
  },
  {
    id: 'blogger-video',
    text: 'Веду YouTube-канал про путешествия. Хочу быстрее делать сценарии, описания, обложки и нарезки для Shorts.',
    answer: 'Монтирую в Premiere.',
    numbers: false,
  },
  {
    id: 'sales-proposals',
    text: 'Менеджер по продажам B2B оборудования. Готовлю коммерческие предложения под каждого клиента — 5 в неделю, по 2 часа на КП.',
    answer: 'Прайс в Excel, шаблон КП в Word, CRM Битрикс24.',
    numbers: true,
  },
  {
    id: 'translator',
    text: 'Переводчик-фрилансер, английский и немецкий. Технические документы, инструкции. Хочу ускорить работу, но не потерять качество.',
    answer: 'Работаю в Trados, глоссарии клиентов в Excel.',
    numbers: false,
  },
  {
    id: 'analyst-reports',
    text: 'Аналитик в ритейле. Каждый понедельник собираю отчёт по продажам из выгрузок, строю графики и пишу выводы для руководства — уходит часа 4.',
    answer: 'Выгрузки CSV из 1С, отчёт в PowerPoint.',
    numbers: true,
  },
  {
    id: 'fitness-coach',
    text: 'Фитнес-тренер онлайн. Составляю программы тренировок и питания, отвечаю клиентам на вопросы в Telegram.',
    answer: 'Около 25 клиентов, программы в Google Таблицах.',
    numbers: false,
  },
  {
    id: 'event-agency',
    text: 'Организую свадьбы. Много переписки с подрядчиками, сметы, тайминги, презентации концепций для пар.',
    answer: 'Сметы в Google Таблицах, переписка в WhatsApp и почте.',
    numbers: false,
  },
  {
    id: 'support-l1',
    text: 'Руководитель поддержки SaaS-сервиса. 300 тикетов в день, половина — типовые вопросы по настройке, оператор тратит на каждый около 5 минут.',
    answer: 'Тикеты в Zendesk, база знаний в Notion.',
    numbers: true,
  },
  {
    id: 'designer',
    text: 'Графический дизайнер. Делаю баннеры для маркетплейсов, клиенты хотят много вариантов быстро.',
    answer: 'Работаю в Figma, продаю на Wildberries и Ozon.',
    numbers: false,
  },
  {
    id: 'manufacturing-quality',
    text: 'Инженер по качеству на заводе. Пишу отчёты о несоответствиях и разбираю причины брака. В неделю 8 отчётов, по 1,5 часа каждый.',
    answer: 'Отчёты в Word по шаблону, данные из MES-системы.',
    numbers: true,
  },
];

export interface TaskResult {
  id: string;
  status: Analysis['status'];
  durationMs: number;
  costUsd: number;
  stages: Record<'context' | 'discovery' | 'plan', { attempts: number; ok: boolean } | null>;
  questions: number;
  opportunities: number;
  feasibility: Record<Opportunity['feasibilityStatus'], number>;
  /** Возможностей с расчётом экономии в часах. */
  estimates: number;
  numbersExpected: boolean;
  /** Числа честные: есть расчёт, когда пользователь дал числа; нет — когда не дал. */
  numbersHonest: boolean;
  planSteps: number;
  error: string | null;
}

/** Шлюз на шаблонах: проверка самого замера без ключа. */
export const dryGateway = {
  async stream(request: GatewayRequest, callbacks: GatewayStreamCallbacks) {
    const stage = (request.task?.id ?? '').split(':')[1];
    const text =
      stage === 'context'
        ? contextTemplate(request.messages[0]?.content ?? '', 'ru')
        : stage === 'plan'
          ? planTemplate('ru')
          : discoveryTemplate('ru');
    callbacks.onDelta(text);
    callbacks.onDone({
      inputTokens: 1,
      outputTokens: 1,
      source: 'provider',
      finishReason: 'stop',
      canContinue: false,
      selectedModel: { id: request.modelId, name: request.modelId },
      costUsd: 0,
      creditsUsd: 0,
    });
  },
};

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const stageReport = (run: { attempts: number; status: string } | undefined) =>
  run ? { attempts: run.attempts, ok: run.status === 'done' } : null;

export async function runTask(
  service: DiscoveryService,
  task: BenchTask,
  mode: AnalysisMode,
  index: number,
): Promise<TaskResult> {
  const caller: DiscoveryCaller = {
    // Свой пользователь на задачу: лимит «один бесплатный анализ в сутки» не мешает замеру.
    userId: `bench_${mode}_${index}_${task.id}`,
    plan: 'free',
    isVip: false,
    anonymous: false,
    guest: false,
    ipHash: null,
    ipLimited: false,
  };
  const started = performance.now();
  const empty: TaskResult = {
    id: task.id,
    status: 'failed',
    durationMs: 0,
    costUsd: 0,
    stages: { context: null, discovery: null, plan: null },
    questions: 0,
    opportunities: 0,
    feasibility: { ready: 0, needs_setup: 0, needs_integration: 0, not_supported: 0 },
    estimates: 0,
    numbersExpected: task.numbers,
    numbersHonest: false,
    planSteps: 0,
    error: null,
  };
  const created = await service.create({
    caller,
    email: null,
    text: task.text,
    language: 'ru',
    mode,
    confirm: true,
    idempotencyKey: null,
  });
  if (!created.ok) return { ...empty, error: `${created.code}: ${created.message}` };
  const id = created.analysis.id;
  const read = async () => (await service.get(caller.userId, id))!;
  const settled = (value: { analysis: Analysis }) =>
    !['analyzing', 'discovering'].includes(value.analysis.status);

  let view = await waitFor(read, settled);
  if (view.analysis.status === 'needs_answers') {
    const answers = Object.fromEntries(
      view.analysis.questions.map((question) => [question.id, { value: task.answer }]),
    );
    const continued = await service.continue(caller, id, { answers, confirm: true });
    if (!continued.ok) return { ...empty, error: `${continued.code}: ${continued.message}` };
    view = await waitFor(read, settled);
  }
  const { analysis, opportunities } = view;
  const feasibility = { ...empty.feasibility };
  for (const item of opportunities) feasibility[item.feasibilityStatus] += 1;
  const estimates = opportunities.filter((item) => item.impact.kind === 'estimate').length;

  // План для первой выполнимой возможности: краткий бесплатный или подробный платный.
  let plan: Plan | null = null;
  const target = opportunities.find((item) => item.feasibilityStatus !== 'not_supported');
  if (analysis.status === 'ready' && target) {
    const createdPlan = await service.createPlan({
      caller,
      analysisId: id,
      opportunityId: target.id,
      confirm: true,
    });
    if (createdPlan.ok) {
      plan = await waitFor(
        async () => (await service.getPlan(caller.userId, createdPlan.plan.id))!,
        (value) => value.status !== 'generating',
      );
    }
  }

  const stageCost = Object.values(analysis.stages).reduce(
    (sum, run) => sum + (run?.costUsd ?? 0),
    0,
  );
  return {
    id: task.id,
    status: analysis.status,
    durationMs: Math.round(performance.now() - started),
    costUsd: Math.round((stageCost + (plan?.run.costUsd ?? 0)) * 1e6) / 1e6,
    stages: {
      context: stageReport(analysis.stages.context),
      discovery: stageReport(analysis.stages.discovery),
      plan: plan ? { attempts: plan.run.attempts, ok: plan.status === 'ready' } : null,
    },
    questions: analysis.questions.length,
    opportunities: opportunities.length,
    feasibility,
    estimates,
    numbersExpected: task.numbers,
    numbersHonest: task.numbers ? estimates > 0 : estimates === 0,
    planSteps: plan?.steps.length ?? 0,
    error:
      analysis.status === 'failed'
        ? (Object.values(analysis.stages).find((run) => run?.error)?.error?.code ?? 'failed')
        : null,
  };
}

export function summarize(results: TaskResult[]) {
  const share = (count: number, total: number) =>
    total === 0 ? '—' : `${count}/${total} (${Math.round((count / total) * 100)}%)`;
  const firstTry = (stage: 'context' | 'discovery' | 'plan') => {
    const runs = results.map((item) => item.stages[stage]).filter((run) => run !== null);
    return share(runs.filter((run) => run.ok && run.attempts === 1).length, runs.length);
  };
  const ready = results.filter((item) => item.status === 'ready');
  const total = (key: keyof TaskResult['feasibility']) =>
    results.reduce((sum, item) => sum + item.feasibility[key], 0);
  const cost = results.reduce((sum, item) => sum + item.costUsd, 0);
  const durations = results.map((item) => item.durationMs).sort((a, b) => a - b);
  return {
    tasks: results.length,
    reports: share(ready.length, results.length),
    validJsonFirstTry: {
      context: firstTry('context'),
      discovery: firstTry('discovery'),
      plan: firstTry('plan'),
    },
    opportunitiesAvg:
      ready.length === 0
        ? 0
        : Math.round(
            (ready.reduce((sum, item) => sum + item.opportunities, 0) / ready.length) * 10,
          ) / 10,
    reportsWithin3to7: share(
      ready.filter((item) => item.opportunities >= 3 && item.opportunities <= 7).length,
      ready.length,
    ),
    feasibility: {
      ready: total('ready'),
      needs_setup: total('needs_setup'),
      needs_integration: total('needs_integration'),
      not_supported: total('not_supported'),
    },
    numbersHonest: share(ready.filter((item) => item.numbersHonest).length, ready.length),
    costUsd: {
      total: Math.round(cost * 1e4) / 1e4,
      perTask: Math.round((cost / Math.max(1, results.length)) * 1e4) / 1e4,
    },
    durationMs: {
      median: durations[Math.floor(durations.length / 2)] ?? 0,
      max: durations.at(-1) ?? 0,
    },
    failures: results.filter((item) => item.error).map((item) => `${item.id}: ${item.error}`),
  };
}

function parseArgs(argv: string[]) {
  const value = (name: string) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const mode = (value('mode') ?? 'free') as AnalysisMode;
  if (!['free', 'paid', 'deep'].includes(mode)) throw new Error(`Неизвестный режим: ${mode}`);
  return {
    mode,
    limit: Number(value('limit') ?? BENCH_TASKS.length),
    concurrency: Math.max(1, Number(value('concurrency') ?? 3)),
    out: value('out'),
    dry: argv.includes('--dry'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dry && !config.openRouterApiKey) {
    console.error(
      'Нужен OPENROUTER_API_KEY (или --dry для проверки самого замера без моделей). Кредиты пользователей не тратятся — только баланс ключа: бесплатный режим ≈ $0.01 за задачу.',
    );
    process.exitCode = 2;
    return;
  }
  const gateway = args.dry
    ? dryGateway
    : new AIGateway({
        aiConfig: config.ai,
        usageStore: new UsageStore(
          join(mkdtempSync(join(tmpdir(), 'ketner-bench-')), 'usage.json'),
        ),
        useMockEngine: false,
      });
  const service = new DiscoveryService({
    store: new MemoryDiscoveryStore(),
    budget: new MemoryBudgetStore(),
    gateway,
    balanceUsd: () => 1000,
    userCapabilities: () => ({ hasPurchasedCredits: true, githubConnected: false }),
    freeDailyUsd: 1000,
    budgetTimeZone: 'UTC',
  });

  const tasks = BENCH_TASKS.slice(0, args.limit);
  const results: TaskResult[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      const task = tasks[index]!;
      try {
        results[index] = await runTask(service, task, args.mode, index);
      } catch (error) {
        results[index] = {
          id: task.id,
          status: 'failed',
          durationMs: 0,
          costUsd: 0,
          stages: { context: null, discovery: null, plan: null },
          questions: 0,
          opportunities: 0,
          feasibility: { ready: 0, needs_setup: 0, needs_integration: 0, not_supported: 0 },
          estimates: 0,
          numbersExpected: task.numbers,
          numbersHonest: false,
          planSteps: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      const item = results[index]!;
      console.log(
        `${String(index + 1).padStart(2)}. ${item.id.padEnd(22)} ${item.status.padEnd(13)} возможностей ${item.opportunities}, расчётов ${item.estimates}, план ${item.planSteps} шагов, $${item.costUsd}, ${item.durationMs} мс${item.error ? ` — ${item.error}` : ''}`,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(args.concurrency, tasks.length) }, worker));
  await service.whenIdle();

  const summary = summarize(results);
  console.log(`\nРежим ${args.mode}${args.dry ? ' (шаблоны, без моделей)' : ''}:`);
  console.log(JSON.stringify(summary, null, 2));
  if (args.out) {
    writeFileSync(
      args.out,
      JSON.stringify(
        { mode: args.mode, dry: args.dry, date: new Date().toISOString(), summary, results },
        null,
        2,
      ),
    );
    console.log(`Подробности: ${args.out}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
