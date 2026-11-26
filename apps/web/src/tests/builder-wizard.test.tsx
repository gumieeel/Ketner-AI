import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import type {
  AutomationView,
  BotOverview,
  LaunchStatus,
  SolutionDetails,
  SolutionView,
} from '@/features/builder/api';
import { BUILDER_WIZARD_LIVE } from '@/features/builder/wizard';
import type { AnalysisView, OpportunityView } from '@/features/discovery/api';
import { en } from '@/i18n/en';
import { ru } from '@/i18n/ru';
import { setSiteFeatures } from '@/lib/features';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function stubFetch(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const call = {
      method: (init.method ?? 'GET').toUpperCase(),
      path: url.pathname,
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
    };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

const OPPORTUNITY: OpportunityView = {
  id: 'o-bot',
  position: 0,
  title: 'Бот отвечает покупателям',
  area: null,
  recipe: 'customer_bot',
  problem: 'Вопросы покупателей ночью остаются без ответа',
  solution: 'Бот на сайте отвечает по каталогу и принимает заявки',
  requires: ['text_generation', 'customer_bot_page'],
  otherRequirement: null,
  dataNeeded: [],
  integrationsNeeded: [],
  effort: 'low',
  effortReason: '',
  risks: [],
  limitations: [],
  successCriteria: [],
  firstStep: '',
  feasibilityStatus: 'ready',
  feasibility: {
    status: 'ready',
    blockers: [
      {
        capability: 'crm',
        label: 'CRM',
        hint: 'Подключение CRM — позже',
        status: 'not_supported',
      },
    ] as never,
    available: [
      {
        capability: 'customer_bot_page',
        label: 'Бот для клиентов',
        hint: '',
        status: 'ready',
      },
    ] as never,
  },
  impact: { kind: 'qualitative', benefit: 'Быстрее отвечать', missing: '', note: '' } as never,
  priority: 0,
};

function analysis(): AnalysisView {
  return {
    id: 'a1',
    status: 'ready',
    mode: 'free',
    language: 'ru',
    guest: false,
    inputText: 'Магазин цветов',
    context: null,
    questions: [],
    answers: {},
    summary: null,
    coverage: null,
    source: null,
    saved: true,
    stages: { context: null, discovery: null },
    opportunities: [OPPORTUNITY],
    cost: { chargedCredits: 0, sponsored: true },
    createdAt: '2026-11-25T10:00:00.000Z',
    updatedAt: '2026-11-25T10:00:00.000Z',
  };
}

function details(patch: Partial<SolutionDetails['solution']> = {}): SolutionDetails {
  return {
    solution: {
      id: 'b1',
      type: 'customer_bot',
      kind: 'assistant',
      template: 'customer_bot',
      bot: {
        slug: 'lisa-shop',
        greeting: 'Здравствуйте!',
        quickReplies: [],
        dailyCapCredits: 1000,
        corrections: [],
      },
      status: 'draft',
      name: 'Лиса',
      currentVersion: 1,
      activeVersion: null,
      source: { analysisId: 'a1', opportunityId: 'o-bot', title: OPPORTUNITY.title },
      createdAt: '2026-11-25T10:00:00.000Z',
      updatedAt: '2026-11-25T10:00:00.000Z',
      ...patch,
    },
    config: {
      name: 'Лиса',
      purpose: 'Отвечает покупателям',
      instructions: '',
      tone: 'friendly',
      knowledge: 'Доставка по Астане — 1–2 дня.',
      examples: [],
      restrictions: [],
      language: 'ru',
    },
    versions: [{ number: 1, createdAt: '2026-11-25T10:00:00.000Z' }],
    cases: [],
    run: null,
    readiness: { ready: false, reason: 'no_cases' } as never,
    testQuote: null,
  };
}

const AUTOMATIONS: AutomationView[] = [
  {
    id: 'lead_to_sheet',
    version: 1,
    event: 'lead.created',
    enabled: true,
    available: true,
    risk: 'low',
    approval: 'none',
    connections: [{ id: 'google_sheets', kind: 'external_service' }],
  },
  {
    id: 'lead_to_manager',
    version: 1,
    event: 'lead.created',
    enabled: true,
    options: { email: true, telegram: true },
    available: true,
    risk: 'low',
    approval: 'none',
    connections: [
      { id: 'owner_email', kind: 'account', optional: true },
      { id: 'owner_telegram', kind: 'account', optional: true },
    ],
  },
  {
    id: 'daily_lead_summary',
    version: 1,
    event: 'schedule.daily',
    enabled: false,
    available: false,
    risk: 'low',
    approval: 'none',
    connections: [{ id: 'owner_email', kind: 'account', optional: true }],
  },
];

function overview(automations = AUTOMATIONS): BotOverview {
  const bot = details().solution.bot!;
  return {
    settings: { ...bot, leadNotify: { email: true, telegram: true } },
    today: { replies: 0, credits: 0, newLeads: 0 },
    publicUrl: 'https://ketner.org/b/lisa-shop',
    leadNotify: { telegramLinked: false },
    automations,
  };
}

/** Сервер для мастера: анализ, список решений, создание, настройки, бот и переключатели. */
function server(
  options: {
    solutions?: SolutionView[];
    solution?: SolutionDetails;
    launch?: Partial<LaunchStatus>;
    sheetConnected?: boolean;
  } = {},
) {
  let current = options.solution ?? details();
  const launch: LaunchStatus = {
    status: 'draft',
    alreadyRunning: false,
    readiness: { ready: true },
    tier: { enforced: true, id: 'start', name: 'Start', active: 0, limit: 1 },
    blocked: null,
    canLaunch: true,
    ...options.launch,
  };
  let bot = overview();
  return stubFetch((call) => {
    if (call.path === '/api/integrations/google') {
      return json(200, {
        connected: options.sheetConnected ?? false,
        status: options.sheetConnected ? 'connected' : null,
        email: null,
        spreadsheetUrl: null,
        lastErrorCode: null,
        connectedAt: null,
        tier: { active: true, name: 'Start', servicesUsed: 0, servicesLimit: 1 },
      });
    }
    if (call.path === '/api/analyses/a1') {
      return json(200, { analysis: analysis(), plans: null, rerun: null, retry: null });
    }
    const path = call.path.replace(/^\/api\/solutions/, '');
    if (path === '' && call.method === 'GET') {
      return json(200, { solutions: options.solutions ?? [] });
    }
    if (path === '/from-opportunity' && call.method === 'POST') {
      return json(201, { solution: current.solution });
    }
    if (path === '/b1' && call.method === 'GET') return json(200, current);
    if (path === '/b1/config' && call.method === 'PUT') {
      current = {
        ...current,
        config: call.body!.config as SolutionDetails['config'],
        solution: { ...current.solution, currentVersion: current.solution.currentVersion + 1 },
      };
      return json(200, current);
    }
    if (path === '/b1/bot' && call.method === 'GET') return json(200, bot);
    if (path === '/b1/launch') return json(200, launch);
    if (path === '/b1/bot/diagram') {
      return json(200, {
        nodes: [
          { id: 'trigger', kind: 'trigger', label: 'Посетитель пишет боту', level: 0, row: 0 },
        ],
        edges: [],
        description: ['Посетитель пишет боту'],
      });
    }
    if (path === '/b1/activate' && call.method === 'POST') {
      current = {
        ...current,
        solution: { ...current.solution, status: 'active', activeVersion: 1 },
      };
      return json(200, current);
    }
    if (path === '/b1/bot' && call.method === 'PUT') {
      const patch = call.body!.automations as Record<string, { enabled?: boolean }>;
      bot = {
        ...bot,
        automations: bot.automations!.map((item) =>
          patch[item.id]?.enabled === undefined
            ? item
            : { ...item, enabled: patch[item.id]!.enabled! },
        ),
      };
      return json(200, bot);
    }
    return json(404, { error: { code: 'not_found', message: '' } });
  });
}

describe('мастер решения: шаги 1–2', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    setSiteFeatures({ discovery: true });
    useAuth.setState({
      status: 'authenticated',
      token: 'mock-token',
      user: { id: 'u1', email: 'owner@example.com', name: 'Owner' } as never,
    });
  });
  afterEach(() => {
    setSiteFeatures(null);
    vi.unstubAllGlobals();
  });

  it('четыре шага с одними подписями; текущий отмечен, будущие — текстом', async () => {
    server();
    renderRoute('/solutions/new?analysis=a1&opportunity=o-bot');
    const steps = await screen.findByRole('navigation', { name: 'Шаги мастера' });
    const items = within(steps).getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('data-step'))).toEqual([
      'analysis',
      'setup',
      'connections',
      'launch',
    ]);
    expect(items.map((item) => within(item).getAllByText(/./)[1]?.textContent)).toEqual([
      'Анализ',
      'Настройка',
      'Подключения',
      'Запуск',
    ]);
    expect(items[0]).toHaveAttribute('aria-current', 'step');
    expect(within(steps).queryAllByRole('link')).toHaveLength(0);
  });

  it('шаг 1 из анализа: возможность, тип, что сделает Ketner; черновик → шаг 2', async () => {
    const calls = server();
    renderRoute('/solutions/new?analysis=a1&opportunity=o-bot');

    expect(await screen.findByRole('heading', { name: 'Бот отвечает покупателям' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Создание ИИ-агента');
    expect(screen.getByText(/ИИ-агент для клиентов: отвечает на вопросы/)).toBeVisible();
    expect(screen.getByText('Бот для клиентов')).toBeVisible();
    expect(screen.getByText('Подключение CRM — позже')).toBeVisible();
    expect(screen.getByText('Пока не поддерживается')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Создать черновик и перейти к настройке' }));
    expect(await screen.findByRole('tab', { name: 'Поведение' })).toBeVisible();
    const post = calls.find((call) => call.method === 'POST');
    expect(post?.path).toBe('/api/solutions/from-opportunity');
    expect(post?.body).toMatchObject({ analysisId: 'a1', opportunityId: 'o-bot' });
    const steps = screen.getByRole('navigation', { name: 'Шаги мастера' });
    expect(within(steps).getAllByRole('listitem')[1]).toHaveAttribute('aria-current', 'step');
  });

  it('решение по возможности уже есть — «Продолжить настройку» без второго черновика', async () => {
    const calls = server({ solutions: [details().solution as unknown as SolutionView] });
    renderRoute('/solutions/new?analysis=a1&opportunity=o-bot');
    const link = await screen.findByRole('link', { name: 'Продолжить настройку' });
    expect(link).toHaveAttribute('href', '/solutions/b1/setup');
    expect(screen.queryByRole('button', { name: /Создать черновик/ })).toBeNull();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('без анализа — с чего начать: анализ бизнеса', async () => {
    server();
    renderRoute('/solutions/new');
    expect(await screen.findByRole('heading', { name: 'С чего начать' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Начать анализ' })).toHaveAttribute('href', '/');
  });

  it('шаг 2: стиль общения и знания сохраняются версией; правки не теряются при смене вкладки', async () => {
    const calls = server();
    renderRoute('/solutions/b1/setup');

    expect(await screen.findByRole('tab', { name: 'Поведение' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const steps = screen.getByRole('navigation', { name: 'Шаги мастера' });
    // Шаг 1 пройден — ссылка к возможности анализа.
    expect(within(steps).getByRole('link', { name: /Анализ/ })).toHaveAttribute(
      'href',
      '/solutions/new?analysis=a1&opportunity=o-bot',
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Официальный' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Знания' }));
    const knowledge = screen.getByRole('textbox', { name: 'Знания' });
    fireEvent.change(knowledge, { target: { value: 'Доставка по Астане — день в день.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить как новую версию' }));

    await waitFor(() =>
      expect(calls.some((call) => call.path === '/api/solutions/b1/config')).toBe(true),
    );
    const put = calls.find((call) => call.path === '/api/solutions/b1/config')!;
    expect(put.body!.config).toMatchObject({
      tone: 'formal',
      knowledge: 'Доставка по Астане — день в день.',
    });
  });

  it('шаг 2: автоматизации — переключатель сохраняется сразу, недоступная — с причиной', async () => {
    const calls = server();
    renderRoute('/solutions/b1/setup');
    // На вкладках настроек кнопка сохранения есть, на вкладке автоматизаций — нет.
    expect(await screen.findByRole('button', { name: 'Сохранить как новую версию' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Автоматизации' }));

    const sheet = document.querySelector('[data-automation="lead_to_sheet"]') as HTMLElement;
    expect(within(sheet).getByText(/Нужна Google Таблица/)).toBeVisible();
    expect(within(sheet).getByText('риск низкий')).toBeVisible();
    fireEvent.click(within(sheet).getByRole('checkbox', { name: /Заявка → таблица/ }));
    await waitFor(() =>
      expect(within(sheet).getByRole('checkbox', { name: /Заявка → таблица/ })).not.toBeChecked(),
    );
    const put = calls.find(
      (call) => call.method === 'PUT' && call.path === '/api/solutions/b1/bot',
    );
    expect(put?.body).toEqual({ automations: { lead_to_sheet: { enabled: false } } });

    const summary = document.querySelector('[data-automation="daily_lead_summary"]') as HTMLElement;
    expect(within(summary).getByRole('checkbox')).toBeDisabled();
    expect(within(summary).getByText(/нужен запуск по расписанию/)).toBeVisible();

    // Каналы уведомлений и подсказка о непривязанном Telegram.
    const manager = document.querySelector('[data-automation="lead_to_manager"]') as HTMLElement;
    expect(within(manager).getByRole('checkbox', { name: 'По почте' })).toBeChecked();
    expect(within(manager).getByText(/Telegram не привязан/)).toBeVisible();
    // На вкладке автоматизаций нет кнопки сохранения настроек.
    expect(screen.queryByRole('button', { name: 'Сохранить как новую версию' })).toBeNull();
  });

  it('шаг 2 справа: проба «как клиент» и статистика с пустым состоянием до запуска', async () => {
    server();
    renderRoute('/solutions/b1/setup');
    const panel = await screen.findByRole('complementary', { name: 'Проверка агента' });
    expect(within(panel).getByRole('tab', { name: 'Предпросмотр' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(panel).getByRole('button', { name: 'Отправить' })).toBeVisible();
    fireEvent.click(within(panel).getByRole('tab', { name: 'Статистика' }));
    expect(within(panel).getByTestId('wizard-stats-empty')).toHaveTextContent(
      'Статистика появится после запуска',
    );
    // Дальше — шаг 3, подключения.
    expect(screen.getByRole('link', { name: 'Далее: подключения' })).toHaveAttribute(
      'href',
      '/solutions/b1/connections',
    );
  });

  it('шаг 2: у работающего агента рядом с переключателями — «изменения действуют сразу»', async () => {
    server({ solution: details({ status: 'active', activeVersion: 1 }) });
    renderRoute('/solutions/b1/setup');
    fireEvent.click(await screen.findByRole('tab', { name: 'Автоматизации' }));
    expect(screen.getByTestId('automations-live')).toHaveTextContent(
      'Агент уже работает: изменения здесь сразу действуют на него.',
    );
  });

  it('шаг 2: у черновика предупреждения о работающем агенте нет', async () => {
    server();
    renderRoute('/solutions/b1/setup');
    fireEvent.click(await screen.findByRole('tab', { name: 'Автоматизации' }));
    expect(screen.queryByTestId('automations-live')).toBeNull();
  });

  it('шаг 3: внешние сервисы (в тарифе), уведомления вам и каналы — отдельно', async () => {
    server();
    renderRoute('/solutions/b1/connections');

    const services = await screen.findByRole('region', { name: 'Внешние сервисы' });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Создание ИИ-агента для клиентов' }),
    ).toBeVisible();
    const steps = screen.getByRole('navigation', { name: 'Шаги мастера' });
    expect(within(steps).getAllByRole('listitem')[2]).toHaveAttribute('aria-current', 'step');
    expect(within(steps).getByRole('link', { name: /Настройка/ })).toHaveAttribute(
      'href',
      '/solutions/b1/setup',
    );

    expect(within(services).getByText(/Считаются в тарифе/)).toBeVisible();
    expect(within(services).getByTestId('sheet-needed')).toHaveTextContent(
      'Нужна для «Заявка → таблица»',
    );
    // Карточка Google Таблицы — та же, что на странице бота (со своим состоянием и тарифом).
    expect(await within(services).findByTestId('google-sheet-card')).toBeVisible();
    const crm = services.querySelector('[data-connection="crm"]') as HTMLElement;
    expect(within(crm).getByText('скоро')).toBeVisible();
    expect(within(crm).queryByRole('button')).toBeNull();

    const notify = screen.getByRole('region', { name: 'Уведомления вам' });
    expect(within(notify).getByText(/Не считаются в тарифе/)).toBeVisible();
    const mail = notify.querySelector('[data-connection="email"]') as HTMLElement;
    expect(within(mail).getByText('Письмо о заявке на owner@example.com.')).toBeVisible();
    expect(within(mail).getByText('работает')).toBeVisible();
    const telegram = notify.querySelector('[data-connection="telegram"]') as HTMLElement;
    expect(within(telegram).getByText('не привязан')).toBeVisible();
    expect(within(telegram).getByRole('link', { name: 'Привязать в настройках' })).toHaveAttribute(
      'href',
      '/settings',
    );

    const channels = screen.getByRole('region', { name: 'Каналы' });
    expect(within(channels).getByText(/Есть на любом тарифе/)).toBeVisible();
    const page = channels.querySelector('[data-connection="page"]') as HTMLElement;
    expect(within(page).getByText('откроется после запуска')).toBeVisible();
    const own = channels.querySelector('[data-connection="telegram-channel"]') as HTMLElement;
    expect(within(own).getByText('позже')).toBeVisible();

    expect(screen.getByRole('link', { name: '← Назад' })).toHaveAttribute(
      'href',
      '/solutions/b1/setup',
    );
    expect(screen.getByRole('link', { name: 'Далее: запуск' })).toHaveAttribute(
      'href',
      '/solutions/b1/launch',
    );
  });

  it('шаг 3: «Заявка → таблица» выключена — таблица не обязательна; уведомления по каталогу', async () => {
    const calls = server();
    renderRoute('/solutions/b1/setup');
    fireEvent.click(await screen.findByRole('tab', { name: 'Автоматизации' }));
    const sheet = document.querySelector('[data-automation="lead_to_sheet"]') as HTMLElement;
    fireEvent.click(within(sheet).getByRole('checkbox', { name: /Заявка → таблица/ }));
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));

    fireEvent.click(screen.getByRole('link', { name: 'Далее: подключения' }));
    expect(await screen.findByTestId('sheet-needed')).toHaveTextContent(
      '«Заявка → таблица» выключена',
    );
  });

  it('шаг 4: всё готово — проверки, схема, «Запустить агента» включает и ведёт на страницу агента', async () => {
    const calls = server({ sheetConnected: true });
    renderRoute('/solutions/b1/launch');

    const checks = await screen.findByRole('region', { name: 'Перед запуском' });
    const steps = screen.getByRole('navigation', { name: 'Шаги мастера' });
    expect(within(steps).getAllByRole('listitem')[3]).toHaveAttribute('aria-current', 'step');
    const row = (id: string) => checks.querySelector(`[data-check="${id}"]`) as HTMLElement;
    expect(row('tests')).toHaveAttribute('data-tone', 'ok');
    expect(row('sheet')).toHaveTextContent('Google Таблица подключена');
    expect(row('notify')).toHaveAttribute('data-tone', 'ok');
    expect(row('approvals')).toHaveTextContent('Подтверждать нечего');
    expect(row('tier')).toHaveTextContent('Тариф Start: работает агентов 0 из 1 — место есть');
    expect(screen.getByRole('heading', { name: 'Как будет работать агент' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Запустить агента' }));
    await waitFor(() =>
      expect(calls.some((call) => call.method === 'POST' && call.path.endsWith('/activate'))).toBe(
        true,
      ),
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Лиса' })).toBeVisible();
  });

  it('шаг 4: нет тарифа — экран «Нужен тариф», кнопки запуска нет, агент остаётся черновиком', async () => {
    const calls = server({
      launch: {
        tier: { enforced: true, id: null, name: null, active: 0, limit: null },
        blocked: { code: 'tier_required', message: 'Запуск агента — при активном тарифе.' },
        canLaunch: false,
      },
    });
    renderRoute('/solutions/b1/launch');

    const need = await screen.findByTestId('need-tier');
    expect(within(need).getByText('Нужен тариф')).toBeVisible();
    const tiers = need.querySelectorAll('[data-tier]');
    expect([...tiers].map((item) => item.getAttribute('data-tier'))).toEqual([
      'start',
      'growth',
      'business',
      'scale',
    ]);
    // Самый младший, где есть место для ещё одного агента.
    expect(within(tiers[0] as HTMLElement).getByText('Подойдёт для этого агента')).toBeVisible();
    expect(within(tiers[0] as HTMLElement).getByText('$10 в месяц')).toBeVisible();
    expect(within(need).getByRole('link', { name: 'Тарифы' })).toHaveAttribute('href', '/pricing');
    expect(within(need).getByText(/остаётся черновиком/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Запустить агента' })).toBeNull();
    const checks = screen.getByRole('region', { name: 'Перед запуском' });
    expect(checks.querySelector('[data-check="tier"]')).toHaveAttribute('data-tone', 'block');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('шаг 4: места в тарифе нет — причина с сервера, кнопка неактивна, ссылки на тарифы', async () => {
    server({
      launch: {
        tier: { enforced: true, id: 'start', name: 'Start', active: 1, limit: 1 },
        blocked: {
          code: 'solution_limit',
          message:
            'Активных решений: 1 из 1 — тариф Start. Чтобы запустить ещё одно, нужен тариф Growth (до 3) — или поставьте на паузу одно из работающих.',
        },
        canLaunch: false,
      },
    });
    renderRoute('/solutions/b1/launch');
    const checks = await screen.findByRole('region', { name: 'Перед запуском' });
    expect(checks.querySelector('[data-check="tier"]')).toHaveTextContent(
      /В тарифе нет места.*Активных решений: 1 из 1 — тариф Start/,
    );
    const action = screen.getByRole('complementary', { name: 'Запуск агента' });
    expect(within(action).getByRole('button', { name: 'Запустить агента' })).toBeDisabled();
    expect(within(action).getByRole('link', { name: 'Тарифы' })).toHaveAttribute(
      'href',
      '/pricing',
    );
    expect(within(action).getByRole('link', { name: 'Мои автоматизации' })).toHaveAttribute(
      'href',
      '/solutions',
    );
  });

  it('шаг 4: тесты не пройдены — блокирует; Таблица не подключена — только предупреждение', async () => {
    server({
      launch: { readiness: { ready: false, reason: 'not_tested' } as never, canLaunch: false },
    });
    renderRoute('/solutions/b1/launch');
    const checks = await screen.findByRole('region', { name: 'Перед запуском' });
    const tests = checks.querySelector('[data-check="tests"]') as HTMLElement;
    expect(tests).toHaveAttribute('data-tone', 'block');
    expect(
      within(tests).getByRole('link', { name: 'Открыть тесты на странице агента' }),
    ).toHaveAttribute('href', '/solutions/b1');
    const sheet = checks.querySelector('[data-check="sheet"]') as HTMLElement;
    expect(sheet).toHaveAttribute('data-tone', 'warn');
    expect(sheet).toHaveTextContent('Запуску не мешает');
    expect(within(sheet).getByRole('link', { name: 'Подключения' })).toHaveAttribute(
      'href',
      '/solutions/b1/connections',
    );
    expect(screen.getByRole('button', { name: 'Запустить агента' })).toBeDisabled();
  });

  it('тип решения в кабинете — «ИИ-агент для клиентов»', () => {
    expect(ru['builder.type.customer_bot']).toBe('ИИ-агент для клиентов');
    expect(en['builder.type.customer_bot']).toBe('AI agent for customers');
  });

  it('не бот для клиентов — мастер ведёт на страницу решения', async () => {
    server({ solution: details({ type: 'assistant', template: 'personal_assistant', bot: null }) });
    renderRoute('/solutions/b1/setup');
    expect(await screen.findByRole('heading', { level: 1, name: 'Лиса' })).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Шаги мастера' })).toBeNull();
  });

  it('тексты мастера без обещаний конверсии и продаж; отчёт ведёт в мастер только после включения', () => {
    for (const dict of [ru, en] as Array<Record<string, string>>) {
      for (const [key, value] of Object.entries(dict)) {
        if (!key.startsWith('wizard.')) continue;
        expect(value, key).not.toMatch(/конверси|продаж|conversion|sales|%/i);
      }
    }
    expect(BUILDER_WIZARD_LIVE).toBe(false);
  });
});
