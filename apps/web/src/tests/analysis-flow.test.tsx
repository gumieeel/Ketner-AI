import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AnalysisView,
  Offer,
  PlanStepStatus,
  PlansSummary,
  PlanView,
  Question,
} from '@/features/discovery/api';
import { useAuth } from '@/features/auth/auth-store';
import { readDraft, saveDraft } from '@/features/discovery/draft';
import { setSiteFeatures } from '@/lib/features';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';

const QUESTIONS: Question[] = [
  {
    id: 'q1',
    text: 'Где сейчас хранятся заказы?',
    reason: 'От этого зависят интеграции',
    optional: false,
    kind: 'text',
  },
  {
    id: 'q2',
    text: 'Как вы отвечаете покупателям?',
    reason: '',
    optional: true,
    kind: 'choice',
    options: ['Почта', 'Мессенджеры'],
  },
];

const stage = (status: 'pending' | 'running' | 'done' | 'failed', extra = {}) => ({
  status,
  model: status === 'done' ? { id: 'ketner-mini', name: 'GPT-6 Luna' } : null,
  attempts: status === 'pending' ? 0 : 1,
  error: null,
  startedAt: null,
  finishedAt: null,
  ...extra,
});

function analysis(patch: Partial<AnalysisView> = {}): AnalysisView {
  return {
    id: 'a1',
    status: 'needs_answers',
    mode: 'free',
    language: 'ru',
    guest: true,
    inputText: 'Веду интернет-магазин, отвечаю покупателям вручную.',
    context: { domain: 'Интернет-магазин', summary: '' },
    questions: QUESTIONS,
    answers: {},
    summary: null,
    coverage: null,
    source: null,
    saved: false,
    stages: { context: stage('done'), discovery: stage('pending') },
    opportunities: [],
    cost: { chargedCredits: 0, sponsored: true },
    createdAt: '2026-10-30T10:00:00.000Z',
    updatedAt: '2026-10-30T10:00:00.000Z',
    ...patch,
  };
}

const READY_PATCH: Partial<AnalysisView> = {
  status: 'ready',
  answers: { q1: { value: 'В таблице' }, q2: { skipped: true } },
  summary: 'Больше всего поможет ИИ в ответах покупателям.',
  stages: { context: stage('done'), discovery: stage('done') },
  opportunities: [
    {
      id: 'o1',
      position: 1,
      title: 'Черновики ответов',
      area: null,
      recipe: null,
      problem: 'Однотипные вопросы',
      solution: 'ИИ пишет черновик, вы проверяете',
      requires: ['text_generation'],
      otherRequirement: null,
      dataNeeded: ['Примеры прошлых ответов'],
      integrationsNeeded: [],
      effort: 'low',
      effortReason: 'Хватит чата',
      risks: ['Неточный ответ без проверки'],
      limitations: ['Не видит заказы'],
      successCriteria: ['Ответ готов за минуту'],
      firstStep: 'Соберите 10 частых вопросов',
      feasibilityStatus: 'ready',
      feasibility: {
        status: 'ready',
        blockers: [],
        available: [
          { capability: 'text_generation', label: 'Текст', hint: 'Есть в чате', status: 'ready' },
        ],
      },
      impact: {
        kind: 'estimate',
        hoursPerWeek: [2, 4],
        formula: '40 раз в неделю × 10 мин × 30–60% работы берёт на себя ИИ',
        inputs: [
          { label: 'Как часто', value: '40 раз в неделю', source: 'user' },
          { label: 'Время за раз', value: '10 мин', source: 'user' },
        ],
        assumptions: ['Время на настройку решения не учтено.'],
        benefit: 'Быстрее отвечать',
        note: 'Это прогноз, а не измеренный результат.',
      },
      priority: 0,
    },
    {
      id: 'o2',
      position: 0,
      title: 'Автоответы в почте',
      area: null,
      recipe: null,
      problem: 'Однотипные письма',
      solution: 'ИИ отвечает сам',
      requires: ['email'],
      otherRequirement: null,
      dataNeeded: [],
      integrationsNeeded: ['Почта'],
      effort: 'high',
      effortReason: '',
      risks: [],
      limitations: [],
      successCriteria: [],
      firstStep: 'Подключите почту',
      feasibilityStatus: 'not_supported',
      feasibility: {
        status: 'not_supported',
        blockers: [
          {
            capability: 'email',
            label: 'Работа с почтой',
            hint: 'Ketner не подключается к почте',
            status: 'not_supported',
          },
        ],
        available: [],
      },
      impact: {
        kind: 'qualitative',
        benefit: 'Меньше ручных ответов',
        missing: 'Чтобы оценить экономию времени, укажите, как часто вы делаете задачу.',
        note: 'Это прогноз, а не измеренный результат.',
      },
      priority: 1,
    },
  ],
};

function plan(patch: Partial<PlanView> = {}): PlanView {
  return {
    id: 'p1',
    analysisId: 'a1',
    opportunityId: 'o1',
    opportunityTitle: 'Черновики ответов',
    kind: 'brief',
    status: 'ready',
    summary: 'Начните с черновиков в чате.',
    steps: [
      {
        id: 's1',
        title: 'Соберите вопросы',
        description: 'Десять частых вопросов',
        dependsOn: [],
        doneWhen: 'Есть список',
        status: 'todo',
        updatedAt: null,
      },
      {
        id: 's2',
        title: 'Попробуйте в чате',
        description: '',
        dependsOn: ['s1'],
        doneWhen: 'Есть черновик',
        status: 'todo',
        updatedAt: null,
      },
      {
        id: 's3',
        title: 'Сравните время',
        description: '',
        dependsOn: ['s1', 's2'],
        doneWhen: '',
        status: 'todo',
        updatedAt: null,
      },
    ],
    risks: ['Ошибки в ответах'],
    successCriteria: ['Ответ за минуту'],
    model: { id: 'ketner-mini', name: 'GPT-6 Luna' },
    error: null,
    cost: { chargedCredits: 0, sponsored: true },
    createdAt: '2026-10-30T11:00:00.000Z',
    updatedAt: '2026-10-30T11:00:00.000Z',
    ...patch,
  };
}

const FREE_PLANS: PlansSummary = {
  offer: {
    free: { available: true, model: 'GPT-6 Luna' },
    paid: {
      model: 'MiMo-V2.6 Pro',
      typicalCredits: 5,
      maxCredits: 15,
      loginRequired: true,
      confirmationRequired: false,
    },
  },
  items: [],
};

const FREE_OFFER: Offer = {
  free: { available: true, model: 'GPT-6 Luna' },
  paid: { model: 'MiMo-V2.6 Pro', typicalCredits: 9, maxCredits: 27, loginRequired: true },
  deep: {
    model: 'Claude Sonnet 5.5',
    typicalCredits: 79,
    maxCredits: 322,
    loginRequired: true,
    confirmationRequired: true,
  },
};

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
}

/** Фейковый сервер `/api/analyses`: состояние анализа меняется действиями, как на сервере. */
function installDiscoveryApi(options: {
  offer?: Offer;
  view?: AnalysisView | null;
  rerun?: unknown;
  retry?: unknown;
  createError?: { status: number; code: string; message: string; details?: unknown };
  plans?: PlansSummary | null;
}) {
  const calls: Call[] = [];
  const state: { view: AnalysisView | null; plan: PlanView | null } = {
    view: options.view ?? null,
    plan: null,
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({
      method,
      path: url.pathname,
      body,
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    const path = url.pathname.replace(/^\/api\/analyses/, '');
    if (path === '/offer') return json(200, options.offer ?? FREE_OFFER);
    if (path === '' && method === 'GET') {
      const items = state.view
        ? [
            {
              id: state.view.id,
              status: state.view.status,
              mode: state.view.mode,
              title: state.view.context?.domain ?? state.view.inputText,
              excerpt: state.view.inputText,
              saved: state.view.saved,
              createdAt: state.view.createdAt,
              updatedAt: state.view.updatedAt,
            },
          ]
        : [];
      return json(200, { analyses: items });
    }
    if (path === '' && method === 'POST') {
      if (options.createError) {
        const { status, ...error } = options.createError;
        return json(status, { error });
      }
      state.view = analysis({ status: 'needs_answers' });
      return json(202, { analysis: state.view });
    }
    if (!state.view || path.split('/')[1] !== state.view.id) {
      return json(404, { error: { code: 'analysis_not_found', message: 'Не найден' } });
    }
    const view = state.view;
    if (path === `/${view.id}` && method === 'GET') {
      return json(200, {
        analysis: view,
        rerun: options.rerun ?? null,
        retry: options.retry ?? null,
        plans: options.plans
          ? {
              ...options.plans,
              items: state.plan
                ? [
                    {
                      id: state.plan.id,
                      opportunityId: state.plan.opportunityId,
                      kind: state.plan.kind,
                      status: state.plan.status,
                    },
                  ]
                : options.plans.items,
            }
          : null,
      });
    }
    if (path === `/${view.id}` && method === 'PATCH') {
      state.view = { ...view, saved: body?.saved === true };
      return json(200, { analysis: state.view });
    }
    if (path === `/${view.id}` && method === 'DELETE') {
      state.view = null;
      return new Response(null, { status: 204 });
    }
    const planMatch = path.match(/^\/[^/]+\/opportunities\/([^/]+)\/plan$/);
    if (planMatch && method === 'POST') {
      state.plan = plan({
        opportunityId: planMatch[1],
        kind: body?.confirm ? 'full' : 'brief',
      });
      return json(202, { plan: state.plan });
    }
    const planPath = path.match(/^\/[^/]+\/plans\/([^/]+)(\/steps\/([^/]+))?$/);
    if (planPath) {
      if (!state.plan || state.plan.id !== planPath[1]) {
        return json(404, { error: { code: 'plan_not_found', message: '' } });
      }
      if (planPath[3] && method === 'PATCH') {
        state.plan = {
          ...state.plan,
          steps: state.plan.steps.map((step) =>
            step.id === planPath[3] ? { ...step, status: body?.status as PlanStepStatus } : step,
          ),
        };
      }
      return json(200, { plan: state.plan, retry: null });
    }
    if (path.endsWith('/answers') && method === 'PUT') {
      state.view = { ...view, answers: body?.answers as AnalysisView['answers'] };
      return json(200, { analysis: state.view });
    }
    if (path.endsWith('/continue')) {
      state.view = { ...view, ...READY_PATCH, answers: body?.answers as AnalysisView['answers'] };
      return json(202, { analysis: state.view, rerun: true });
    }
    if (path.endsWith('/retry')) {
      state.view = { ...view, ...READY_PATCH };
      return json(202, { analysis: state.view });
    }
    return json(404, { error: { code: 'not_found', message: '' } });
  });
  return { calls, state };
}

describe('анализ задачи: начало, вопросы, результат', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    setSiteFeatures({ discovery: true });
  });
  afterEach(() => {
    setSiteFeatures(null);
    vi.unstubAllGlobals();
  });

  it('начало: описание, бесплатный анализ дня с моделью; запуск с ключом идемпотентности', async () => {
    saveDraft('Веду интернет-магазин, отвечаю покупателям вручную.');
    const api = installDiscoveryApi({});
    renderRoute('/analyses/new');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Проверим, где ИИ поможет' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Веду интернет-магазин, отвечаю покупателям вручную.'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        'Модель GPT-6 Luna. Кредиты не списываются — один такой анализ в сутки.',
      ),
    ).toBeInTheDocument();
    // Анализ за кредиты: настоящие имена моделей и цена до запуска; гостю — через вход.
    expect(screen.getByText(/MiMo-V2\.6 Pro/)).toBeInTheDocument();
    expect(screen.getByText('≈ 9, не больше 27 кредитов')).toBeInTheDocument();
    expect(screen.getByText('≈ 79, не больше 322 кредита')).toBeInTheDocument();
    expect(
      screen.getAllByRole('link', { name: 'Войти и запустить за кредиты' })[0],
    ).toHaveAttribute('href', '/login?redirect=%2Fanalyses%2Fnew');

    fireEvent.click(screen.getByRole('button', { name: 'Начать анализ' }));
    expect(await screen.findByRole('heading', { name: 'Пара уточнений' })).toBeInTheDocument();
    const create = api.calls.find(
      (call) => call.method === 'POST' && call.path === '/api/analyses',
    );
    expect(create?.body).toMatchObject({ text: expect.stringContaining('интернет-магазин') });
    expect(create?.body).not.toHaveProperty('mode');
    expect(create?.headers['Idempotency-Key']).toMatch(/^an_[A-Za-z0-9]{8,}/);
    expect(readDraft()).toBeNull();
  });

  it('бесплатный анализ недоступен: причина, время сброса и анализ за кредиты', async () => {
    saveDraft('Веду интернет-магазин, отвечаю покупателям вручную.');
    installDiscoveryApi({
      offer: {
        ...FREE_OFFER,
        free: {
          available: false,
          reason: 'budget_exhausted',
          resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
      },
    });
    renderRoute('/analyses/new');
    expect(
      await screen.findByText(
        'Бесплатные анализы на сегодня закончились — их число в сутки ограничено.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Новые станут доступны .*после \d\d:\d\d\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Начать анализ' })).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Войти и запустить за кредиты' })).toHaveLength(2);
  });

  it('вопросы по одному, как в разговоре: реплика, цель вопроса, прогресс; черновик на сервере', async () => {
    const api = installDiscoveryApi({
      view: analysis({
        context: {
          domain: 'Интернет-магазин',
          summary: '',
          intro: 'Понял. Давайте разберёмся, как сейчас поступают заявки.',
        },
      }),
    });
    const first = renderRoute('/analyses/a1');
    expect(
      await screen.findByText('Понял. Давайте разберёмся, как сейчас поступают заявки.'),
    ).toBeInTheDocument();
    expect(screen.getByText('0 из 2')).toBeInTheDocument();
    expect(
      screen.getByText('Вопрос 1 из 2 · Зачем: От этого зависят интеграции'),
    ).toBeInTheDocument();
    // Второй вопрос ещё не показан: по одному за раз.
    expect(screen.queryByText('Как вы отвечаете покупателям?')).toBeNull();

    const field = screen.getByRole('textbox', { name: 'Где сейчас хранятся заказы?' });
    fireEvent.change(field, { target: { value: 'В Google Таблицах' } });
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));

    expect(await screen.findByText('Вопрос 2 из 2')).toBeInTheDocument();
    expect(screen.getByText('1 из 2')).toBeInTheDocument();
    // Ответ остался в разговоре.
    expect(screen.getByText('В Google Таблицах')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Мессенджеры' }));
    expect(await screen.findByRole('button', { name: 'Показать результат' })).toBeInTheDocument();

    await waitFor(
      () =>
        expect(api.calls.filter((call) => call.method === 'PUT').at(-1)?.body).toEqual({
          answers: { q1: { value: 'В Google Таблицах' }, q2: { value: 'Мессенджеры' } },
        }),
      { timeout: 3000 },
    );
    // Модель не вызывалась: только черновик.
    expect(api.calls.some((call) => call.path.endsWith('/continue'))).toBe(false);

    // После перезагрузки разговор продолжается с того же места; ответ можно изменить.
    first.unmount();
    renderRoute('/analyses/a1');
    expect(await screen.findByRole('button', { name: 'Показать результат' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Изменить: Где сейчас хранятся заказы?' }));
    expect(screen.getByRole('textbox', { name: 'Где сейчас хранятся заказы?' })).toHaveValue(
      'В Google Таблицах',
    );
  });

  it('результат начинается с профиля бизнеса, проблем и объёма внедрения', async () => {
    installDiscoveryApi({
      view: analysis({
        ...READY_PATCH,
        context: {
          domain: 'Интернет-магазин одежды',
          summary: 'Клиенты пишут в мессенджеры, заказы ведутся в таблице.',
          tools: [
            { text: 'WhatsApp', source: 'user' },
            { text: 'Google Таблицы', source: 'user' },
          ],
          recurringProcesses: [
            {
              title: 'Заказ',
              steps: ['Клиент пишет в WhatsApp', 'Менеджер отвечает', 'Заказ в таблицу'],
            },
          ],
        },
      }),
    });
    renderRoute('/analyses/a1');

    const profile = (await screen.findByRole('heading', { name: 'Ваш бизнес' })).closest(
      'section',
    )!;
    expect(within(profile).getByText('Интернет-магазин одежды')).toBeInTheDocument();
    expect(
      within(profile).getByText('Клиент пишет в WhatsApp → Менеджер отвечает → Заказ в таблицу'),
    ).toBeInTheDocument();
    expect(within(profile).getByText('Google Таблицы')).toBeInTheDocument();

    const problems = screen
      .getByRole('heading', { name: 'Что отнимает время' })
      .closest('section')!;
    expect(within(problems).getByText('Однотипные вопросы')).toBeInTheDocument();

    const scope = screen.getByRole('heading', { name: 'Объём внедрения' }).closest('section')!;
    expect(
      within(scope).getByText('Можно сделать сейчас: 1 · Пока не поддерживается: 1'),
    ).toBeInTheDocument();
    // Интеграции неподдерживаемой возможности в объём не входят.
    expect(within(scope).getByText('Внешние интеграции не нужны')).toBeInTheDocument();
    expect(
      within(scope).getByText('Небольшой: всё можно запустить без сложных интеграций.'),
    ).toBeInTheDocument();
  });

  it('экран результата: итог, время анализа, экономия по числам, «Рекомендуем начать», остальное по кнопке', async () => {
    const [drafts, mail] = READY_PATCH.opportunities ?? [];
    const extra = (id: string, title: string, priority: number) => ({
      ...drafts!,
      id,
      title,
      priority,
      impact: { kind: 'qualitative' as const, benefit: 'польза', missing: '', note: '' },
    });
    installDiscoveryApi({
      view: analysis({
        ...READY_PATCH,
        stages: {
          context: stage('done', {
            startedAt: '2026-11-06T10:00:00.000Z',
            finishedAt: '2026-11-06T10:00:40.000Z',
          }),
          discovery: stage('done', {
            startedAt: '2026-11-06T10:05:00.000Z',
            finishedAt: '2026-11-06T10:06:34.000Z',
          }),
        },
        opportunities: [drafts!, mail!, extra('o3', 'Третья', 3), extra('o4', 'Четвёртая', 4)],
      }),
    });
    renderRoute('/analyses/a1');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Анализ завершён' }),
    ).toBeInTheDocument();
    // Время — только работа этапов (40 с + 94 с), без паузы на ответы.
    expect(screen.getByText('2 мин 14 сек')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Назад к анализам' })).toHaveAttribute(
      'href',
      '/analyses',
    );
    const summary = screen.getByRole('heading', { name: 'Краткое резюме' }).closest('section')!;
    expect(within(summary).getByText('Потенциальная экономия времени')).toBeInTheDocument();
    expect(within(summary).getByText('≈ 2–4 ч в неделю')).toBeInTheDocument();

    const featured = screen.getByText('Рекомендуем начать').closest('li')!;
    expect(within(featured).getByRole('heading', { name: 'Черновики ответов' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Четвёртая' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ещё возможности: 1' }));
    expect(screen.getByRole('heading', { name: 'Четвёртая' })).toBeVisible();

    const aside = screen.getByRole('complementary', { name: 'Что дальше' });
    expect(within(aside).getByRole('heading', { name: 'Ваш план внедрения' })).toBeVisible();
    expect(within(aside).getByRole('heading', { name: 'Сохранить анализ' })).toBeVisible();
    expect(within(aside).getByRole('link', { name: 'Войти и перейти к решениям' })).toHaveAttribute(
      'href',
      '/login?redirect=%2Fanalyses%2Fa1',
    );
  });

  it('пропуск: необязательный — «Пропустить», обязательный — «Не знаю»; результат по кнопке', async () => {
    const api = installDiscoveryApi({ view: analysis() });
    renderRoute('/analyses/a1');
    // Реплики модели нет — общая.
    expect(
      await screen.findByText(
        'Понял. Уточню пару деталей, чтобы рекомендации подошли именно вашему бизнесу.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Не знаю — пропустить' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Пропустить' }));
    expect(screen.getAllByText('Пропущено')).toHaveLength(2);
    expect(api.calls.some((call) => call.path.endsWith('/continue'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Показать результат' }));
    expect(await screen.findByRole('heading', { name: 'Возможности для вас' })).toBeInTheDocument();
    const sent = api.calls.find((call) => call.path.endsWith('/continue'));
    expect(sent?.body).toEqual({ answers: { q1: { skipped: true }, q2: { skipped: true } } });
  });

  it('анализ по плану: главная рекомендация с «Приступить к автоматизации», карта областей, сайт', async () => {
    const [draftsCard, mailCard] = READY_PATCH.opportunities ?? [];
    installDiscoveryApi({
      view: analysis({
        ...READY_PATCH,
        source: { url: 'https://www.lisa.kz/', ok: true, title: 'Лиса' },
        coverage: [
          { area: 'clients', status: 'found', opportunities: 2, note: 'Вопросы покупателей' },
          { area: 'sales', status: 'unclear', opportunities: 0, note: '' },
          { area: 'content', status: 'not_relevant', opportunities: 0, note: 'Не ведёт соцсети' },
          { area: 'documents', status: 'unclear', opportunities: 0, note: '' },
          { area: 'routine', status: 'unclear', opportunities: 0, note: '' },
        ],
        opportunities: [
          { ...mailCard!, area: 'clients', recipe: null },
          { ...draftsCard!, area: 'clients', recipe: 'personal_assistant' },
        ],
      }),
    });
    renderRoute('/analyses/a1');

    expect(await screen.findByText('Рекомендуем начать')).toBeInTheDocument();
    expect(screen.getByText('Прочитали сайт lisa.kz.')).toBeInTheDocument();
    const main = screen.getByText('Рекомендуем начать').closest('li')!;
    expect(within(main).getByRole('heading', { name: 'Черновики ответов' })).toBeInTheDocument();
    expect(
      within(main).getByText('Клиенты и переписка · Готовая автоматизация: личный помощник'),
    ).toBeInTheDocument();
    // Гость: запуск автоматизации — после входа, с возвратом к отчёту.
    expect(
      within(main).getByRole('link', { name: 'Войти и приступить к автоматизации' }),
    ).toHaveAttribute('href', `/login?redirect=${encodeURIComponent('/analyses/a1')}`);

    const map = screen.getByRole('heading', { name: 'Что проверил анализ' }).closest('section')!;
    const areas = within(map).getAllByRole('listitem');
    expect(areas).toHaveLength(5);
    expect(within(areas[0]!).getByText('Нашли: 2')).toBeInTheDocument();
    expect(within(areas[2]!).getByText('Не относится')).toBeInTheDocument();
    expect(within(areas[1]!).getByText('Мало сведений')).toBeInTheDocument();

    // Остальные возможности — ниже, без пометки; у возможности без рецепта кнопки запуска нет.
    const others = screen.getByRole('heading', { name: 'Автоответы в почте' }).closest('li')!;
    expect(within(others).queryByText('Рекомендуем начать')).toBeNull();
    expect(within(others).queryByText(/приступить/i)).not.toBeInTheDocument();
  });

  it('учебный помощник в отчёте: создать сразу, бесплатно и без цены черновика; создаётся инструмент', async () => {
    useAuth.setState({
      status: 'authenticated',
      token: 'mock-token',
      user: { id: 'u1', email: 'student@example.com', name: 'Student', plan: 'credits' } as never,
    });
    const [draftsCard, mailCard] = READY_PATCH.opportunities ?? [];
    installDiscoveryApi({
      view: analysis({
        ...READY_PATCH,
        coverage: [
          { area: 'clients', status: 'unclear', opportunities: 0, note: '' },
          { area: 'sales', status: 'unclear', opportunities: 0, note: '' },
          { area: 'content', status: 'unclear', opportunities: 0, note: '' },
          { area: 'documents', status: 'found', opportunities: 2, note: 'Учебные материалы' },
          { area: 'routine', status: 'unclear', opportunities: 0, note: '' },
        ],
        opportunities: [
          {
            ...draftsCard!,
            title: 'Подготовка к экзамену',
            area: 'documents',
            recipe: 'study_assistant',
          },
          { ...mailCard!, area: 'documents', recipe: null },
        ],
      }),
    });
    const discoveryFetch = globalThis.fetch;
    const posted: Array<Record<string, unknown> | null> = [];
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path === '/api/solutions') return reply(200, { solutions: [], runway: null });
      // Цена черновика помощника недоступна — учебному помощнику она и не нужна.
      if (path === '/api/solutions/draft-quote') {
        return reply(503, { error: { code: 'unavailable', message: '' } });
      }
      if (path === '/api/solutions/from-opportunity') {
        posted.push(init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null);
        return reply(201, {
          solution: { id: 's9', type: 'tool', kind: 'tool', template: 'study_assistant' },
        });
      }
      if (path.startsWith('/api/solutions/s9')) {
        return reply(404, { error: { code: 'solution_not_found', message: '' } });
      }
      return discoveryFetch(input, init);
    });
    renderRoute('/analyses/a1');

    const main = (await screen.findByText('Рекомендуем начать')).closest('li')!;
    expect(
      within(main).getByText('Документы и отчёты · Готовый инструмент: учебный помощник'),
    ).toBeInTheDocument();
    expect(within(main).getByText(/Создаётся бесплатно/)).toBeInTheDocument();
    expect(within(main).queryByText(/Модель подготовит настройки/)).not.toBeInTheDocument();
    const create = within(main).getByRole('button', { name: 'Создать учебного помощника' });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ analysisId: 'a1', opportunityId: draftsCard!.id });
  });

  it('результат: возможности со статусом реализуемости, цена; правка ответов — только при изменении и с ценой', async () => {
    const api = installDiscoveryApi({
      view: analysis({ ...READY_PATCH, guest: false }),
      rerun: { model: 'GPT-6 Luna', typicalCredits: 2, maxCredits: 7, loginRequired: false },
    });
    renderRoute('/analyses/a1');

    expect(await screen.findByRole('heading', { name: 'Возможности для вас' })).toBeInTheDocument();
    expect(screen.getByText('Бесплатно')).toBeInTheDocument();
    expect(screen.getByText('Анализ дня — кредиты не списаны')).toBeInTheDocument();
    const cards = screen
      .getAllByRole('listitem')
      .filter((item) => within(item).queryByRole('heading'));
    expect(cards.map((card) => within(card).getByRole('heading').textContent)).toEqual([
      'Черновики ответов',
      'Автоответы в почте',
    ]);
    expect(within(cards[0]).getAllByText('Можно сделать сейчас')[0]).toBeVisible();
    expect(within(cards[1]).getAllByText('Пока не поддерживается')[0]).toBeVisible();
    expect(within(cards[0]).getAllByText(/≈ 2–4 ч в неделю/)[0]).toBeVisible();
    // Модели — в «Подробнее», а не в статусе этапа.
    expect(screen.queryByText(/готово · GPT-6 Luna/)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Модели анализа: Разбор задачи — GPT-6 Luna; Поиск возможностей — GPT-6 Luna.',
      ),
    ).not.toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Изменить ответы' }));
    const update = screen.getByRole('button', { name: 'Обновить анализ' });
    expect(update).toBeDisabled();
    expect(screen.getByText('Ответы не изменились — анализ остаётся прежним.')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: /Где сейчас хранятся заказы/ }), {
      target: { value: 'В 1С' },
    });
    expect(screen.getByText(/≈ 2, не больше 7 кредитов · GPT-6 Luna/)).toBeInTheDocument();
    expect(update).toBeEnabled();
    fireEvent.click(update);
    await waitFor(() =>
      expect(api.calls.find((call) => call.path.endsWith('/continue'))?.body).toEqual({
        answers: { q1: { value: 'В 1С' }, q2: { skipped: true } },
        confirm: true,
      }),
    );
  });

  it('отчёт: с чего начать, все поля возможности, польза с формулой; неподдерживаемое честно названо', async () => {
    installDiscoveryApi({ view: analysis({ ...READY_PATCH, guest: false }) });
    renderRoute('/analyses/a1');
    await screen.findByRole('heading', { name: 'Возможности для вас' });

    // План внедрения — только то, что можно сделать: шаг неподдерживаемой возможности не предлагается.
    const start = screen.getByRole('heading', { name: 'Ваш план внедрения' }).closest('section')!;
    expect(within(start as HTMLElement).getByText('Соберите 10 частых вопросов')).toBeVisible();
    expect(within(start as HTMLElement).queryByText('Подключите почту')).toBeNull();

    const card = screen.getByRole('heading', { name: 'Черновики ответов' }).closest('li')!;
    const more = within(card).getByRole('button', { name: 'Подробнее' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(within(card).getByText('Примеры прошлых ответов')).not.toBeVisible();
    fireEvent.click(more);
    expect(within(card).getByRole('button', { name: 'Свернуть' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    for (const text of [
      'Однотипные вопросы',
      'Примеры прошлых ответов',
      'Сложность низкая. Хватит чата',
      'Неточный ответ без проверки',
      'Не видит заказы',
      'Ответ готов за минуту',
      '40 раз в неделю × 10 мин × 30–60% работы берёт на себя ИИ',
      'Время на настройку решения не учтено.',
    ]) {
      expect(within(card).getByText(text)).toBeVisible();
    }
    expect(within(card).getByText(/Как часто: 40 раз в неделю/)).toBeVisible();
    expect(within(card).getAllByText(/из вашего описания/)).toHaveLength(2);

    // Неподдерживаемое: что именно Ketner не умеет; кнопок создания решения нет нигде.
    const unsupported = screen.getByRole('heading', { name: 'Автоответы в почте' }).closest('li')!;
    expect(
      within(unsupported).getByText(/Ketner пока не умеет этого сам: Работа с почтой\./),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: /Создать решение/ })).toBeNull();
  });

  it('«Сохранить анализ»: в аккаунте — переключатель, гостю — вход', async () => {
    const api = installDiscoveryApi({ view: analysis({ ...READY_PATCH, guest: false }) });
    const first = renderRoute('/analyses/a1');
    const save = await screen.findByRole('button', { name: 'Сохранить анализ' });
    expect(save).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(save);
    expect(await screen.findByRole('button', { name: 'Сохранён' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(api.calls.find((call) => call.method === 'PATCH')?.body).toEqual({ saved: true });
    first.unmount();

    installDiscoveryApi({ view: analysis(READY_PATCH) });
    renderRoute('/analyses/a1');
    expect(await screen.findByRole('link', { name: 'Войти, чтобы сохранить' })).toHaveAttribute(
      'href',
      '/login?redirect=%2Fanalyses%2Fa1',
    );
  });

  it('«Мои анализы»: сохранённые сверху, открыть и удалить с подтверждением', async () => {
    const api = installDiscoveryApi({ view: analysis({ ...READY_PATCH, saved: true }) });
    renderRoute('/analyses');
    expect(await screen.findByRole('heading', { level: 1, name: 'Мои анализы' })).toBeVisible();
    const saved = await screen.findByRole('heading', { level: 2, name: 'Сохранённые' });
    const link = within(saved.parentElement!).getByRole('link', { name: 'Интернет-магазин' });
    expect(link).toHaveAttribute('href', '/analyses/a1');
    expect(screen.getByText(/Готов ·/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Удалить: Интернет-магазин' }));
    const dialog = screen.getByRole('dialog', { name: 'Удалить анализ?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    expect(await screen.findByText(/Анализов пока нет/)).toBeVisible();
    expect(
      api.calls.some((call) => call.method === 'DELETE' && call.path === '/api/analyses/a1'),
    ).toBe(true);
  });

  it('план: бесплатный краткий для одной возможности, у неподдерживаемой — нет; шаги со статусами', async () => {
    const api = installDiscoveryApi({ view: analysis(READY_PATCH), plans: FREE_PLANS });
    renderRoute('/analyses/a1');
    await screen.findByRole('heading', { name: 'Возможности для вас' });
    const supported = screen.getByRole('heading', { name: 'Черновики ответов' }).closest('li')!;
    const unsupported = screen.getByRole('heading', { name: 'Автоответы в почте' }).closest('li')!;
    expect(within(unsupported).queryByRole('button', { name: /план/i })).toBeNull();
    // «Создать помощника» — только у того, что Ketner умеет; гостю — через вход (в «Подробнее»).
    expect(within(unsupported).queryByRole('link', { name: /помощника/ })).toBeNull();
    fireEvent.click(within(supported).getByRole('button', { name: 'Подробнее' }));
    expect(
      within(supported).getByRole('link', { name: 'Войти, чтобы создать помощника' }),
    ).toHaveAttribute('href', '/login?redirect=%2Fanalyses%2Fa1');
    expect(
      within(supported).getByText('Бесплатно для одной возможности этого анализа'),
    ).toBeVisible();
    fireEvent.click(
      within(supported).getByRole('button', { name: 'Составить краткий план — бесплатно' }),
    );

    expect(
      await screen.findByRole('heading', { level: 1, name: 'План: Черновики ответов' }),
    ).toBeVisible();
    const create = api.calls.find((call) => call.path.endsWith('/opportunities/o1/plan'));
    expect(create?.body).toEqual({});
    expect(screen.getByText('Сделано 0 из 3')).toBeVisible();
    expect(screen.getByText('Краткий план · бесплатно · GPT-6 Luna')).toBeVisible();
    const third = screen.getByRole('heading', { name: /Сравните время/ }).closest('li')!;
    expect(within(third).getByText('1, 2')).toBeVisible();

    fireEvent.change(screen.getByRole('combobox', { name: 'Статус шага 1' }), {
      target: { value: 'done' },
    });
    expect(await screen.findByText('Сделано 1 из 3')).toBeVisible();
    await waitFor(() =>
      expect(api.calls.find((call) => call.method === 'PATCH')).toMatchObject({
        path: '/api/analyses/a1/plans/p1/steps/s1',
        body: { status: 'done' },
      }),
    );
    // Пропущенный шаг не считается в прогрессе.
    fireEvent.change(screen.getByRole('combobox', { name: 'Статус шага 3' }), {
      target: { value: 'skipped' },
    });
    expect(await screen.findByText('Сделано 1 из 2')).toBeVisible();
  });

  it('бесплатный план использован: следующий — за кредиты с ценой и согласием; гостю — вход', async () => {
    const paidPlans: PlansSummary = {
      offer: {
        free: { available: false, usedFor: 'o9' },
        paid: { ...FREE_PLANS.offer.paid, loginRequired: false },
      },
      items: [],
    };
    const api = installDiscoveryApi({
      view: analysis({ ...READY_PATCH, guest: false }),
      plans: paidPlans,
    });
    const first = renderRoute('/analyses/a1');
    await screen.findByRole('heading', { name: 'Возможности для вас' });
    const card = screen.getByRole('heading', { name: 'Черновики ответов' }).closest('li')!;
    expect(within(card).getByText('Подробный план: ≈ 5, не больше 15 кредитов')).toBeVisible();
    fireEvent.click(within(card).getByRole('button', { name: 'Составить план за кредиты' }));
    await screen.findByRole('heading', { level: 1, name: 'План: Черновики ответов' });
    expect(api.calls.find((call) => call.path.endsWith('/plan'))?.body).toEqual({ confirm: true });
    first.unmount();

    installDiscoveryApi({
      view: analysis(READY_PATCH),
      plans: { ...paidPlans, offer: { ...paidPlans.offer, paid: FREE_PLANS.offer.paid } },
    });
    renderRoute('/analyses/a1');
    await screen.findByRole('heading', { name: 'Возможности для вас' });
    expect(
      screen.getAllByRole('link', { name: 'Войти и составить план за кредиты' })[0],
    ).toHaveAttribute('href', '/login?redirect=%2Fanalyses%2Fa1');
  });

  it('составленный план открывается из отчёта', async () => {
    installDiscoveryApi({
      view: analysis(READY_PATCH),
      plans: {
        ...FREE_PLANS,
        items: [{ id: 'p7', opportunityId: 'o1', kind: 'brief', status: 'ready' }],
      },
    });
    renderRoute('/analyses/a1');
    // В карточке возможности и в «Вашем плане внедрения» справа.
    const links = await screen.findAllByRole('link', { name: 'Открыть план' });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute('href', '/analyses/a1/plans/p7');
  });

  it('гость меняет ответы после отчёта — вход, а не списание', async () => {
    installDiscoveryApi({
      view: analysis(READY_PATCH),
      rerun: { model: 'GPT-6 Luna', typicalCredits: 2, maxCredits: 7, loginRequired: true },
    });
    renderRoute('/analyses/a1');
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить ответы' }));
    expect(screen.getByRole('link', { name: 'Войти, чтобы обновить анализ' })).toHaveAttribute(
      'href',
      '/login?redirect=%2Fanalyses%2Fa1',
    );
    expect(screen.queryByRole('button', { name: 'Обновить анализ' })).toBeNull();
  });

  it('этап упал: причина и повтор; бесплатный повтор назван бесплатным', async () => {
    const api = installDiscoveryApi({
      view: analysis({
        status: 'failed',
        answers: { q1: { value: 'В таблице' } },
        stages: {
          context: stage('done'),
          discovery: stage('failed', {
            error: { code: 'provider_error', message: 'Модель временно недоступна.' },
          }),
        },
      }),
      retry: { stage: 'discovery', sponsored: true },
    });
    renderRoute('/analyses/a1');
    expect(
      await screen.findByRole('heading', { name: 'Этап «Поиск возможностей» не выполнен' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Модель временно недоступна.')).toBeInTheDocument();
    expect(screen.getByText('Повтор бесплатный.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить этап' }));
    expect(await screen.findByRole('heading', { name: 'Возможности для вас' })).toBeInTheDocument();
    expect(api.calls.some((call) => call.path.endsWith('/retry'))).toBe(true);
  });

  it('чужой или несуществующий анализ — «не найден» с выходом', async () => {
    installDiscoveryApi({ view: null });
    renderRoute('/analyses/zzz');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Анализ не найден' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Новый анализ' })).toHaveAttribute('href', '/');
  });

  it('без DISCOVERY_ENABLED страниц анализа нет', () => {
    setSiteFeatures(null);
    renderRoute('/analyses/a1');
    expect(screen.queryByRole('heading', { name: 'Анализ задачи' })).toBeNull();
  });
});
