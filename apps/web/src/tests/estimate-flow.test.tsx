import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import type { AnalysisView } from '@/features/discovery/api';
import type { EstimateView, RequestView } from '@/features/pricing/api';
import { setSiteFeatures } from '@/lib/features';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';

const stage = {
  status: 'done',
  model: null,
  attempts: 1,
  error: null,
  startedAt: null,
  finishedAt: null,
};

const ANALYSIS: AnalysisView = {
  id: 'a1',
  status: 'ready',
  mode: 'free',
  language: 'ru',
  guest: false,
  inputText: 'Интернет-магазин одежды, клиенты пишут в WhatsApp.',
  context: {
    domain: 'Интернет-магазин',
    summary: 'Ручные ответы клиентам',
    profile: {
      businessName: null,
      industry: 'online_store',
      subIndustry: null,
      city: 'Караганда',
      businessModel: 'b2c',
      website: null,
      teamSize: '2_5',
      customerChannels: ['whatsapp'],
      existingTools: [],
      monthlyRequests: null,
      monthlyOrders: null,
      additionalContext: null,
    },
  },
  questions: [],
  answers: {},
  summary: 'ИИ возьмёт на себя типовые вопросы.',
  coverage: null,
  source: null,
  saved: true,
  stages: { context: stage as never, discovery: stage as never },
  opportunities: [
    {
      id: 'o1',
      position: 0,
      title: 'ИИ-консультант по товарам',
      area: null,
      recipe: null,
      problem: 'Менеджеры отвечают на одни и те же вопросы',
      solution: 'Отвечает на типовые вопросы и передаёт сложные сотруднику',
      requires: ['text_generation'],
      otherRequirement: null,
      dataNeeded: [],
      integrationsNeeded: ['CRM'],
      effort: 'medium',
      effortReason: '',
      risks: [],
      limitations: [],
      successCriteria: [],
      firstStep: 'Соберите частые вопросы',
      solutionType: 'assistant',
      feasibilityStatus: 'ready',
      feasibility: { status: 'ready', blockers: [], available: [] },
      impact: { kind: 'qualitative', benefit: 'Быстрее ответы', missing: '', note: '' },
      priority: 0,
    },
  ],
  cost: { chargedCredits: 0, sponsored: true },
  createdAt: '2026-11-07T10:00:00.000Z',
  updatedAt: '2026-11-07T10:00:00.000Z',
};

const ESTIMATE: EstimateView = {
  id: 'e1',
  scope: 'opportunity',
  scopeKey: 'opp:o1',
  opportunityIds: ['o1'],
  opportunityTitles: { o1: 'ИИ-консультант по товарам' },
  solutionTypes: ['assistant'],
  // Число нарочно «некруглое»: сайт показывает ровно то, что посчитал сервер.
  priceKzt: { min: 85_000, expected: 115_000, max: 145_000 },
  pricingDisabled: false,
  minimumApplied: false,
  sharedSavingsKzt: null,
  workingDays: { min: 4, max: 9 },
  externalApproval: true,
  delivery: {
    kind: 'team',
    plannedWork: [],
    teamWork: ['Интеграция с CRM'],
    priceList: null,
    paidTierRequired: true,
    tier: { id: 'growth', name: 'Growth', priceUsd: 29, monthlyRequests: 5000 },
    volumeKnown: false,
  },
  confidence: 'medium',
  confidenceReasons: ['unknowns'],
  requiresManualReview: true,
  technicalVerificationRequired: true,
  work: [
    {
      capabilityId: 'crm_integration',
      name: { ru: 'Интеграция с CRM', en: 'CRM integration' },
      category: 'integration',
      complexity: 'medium',
      quantity: 1,
      requiresManualReview: true,
      shared: false,
      includes: ['Обмен заказами с CRM через её API'],
      prerequisites: [],
    },
  ],
  projectWork: [{ ru: 'Подготовка и архитектура', en: 'Preparation and architecture' }],
  excluded: [],
  unknownDirectCosts: ['Интеграция с CRM'],
  assumptions: ['Есть актуальный каталог'],
  unknowns: ['Где хранится каталог'],
  exclusions: ['Тариф CRM — отдельно'],
  monthly: {
    usdToKztRate: null,
    recurring: [],
    usage: {
      status: 'volume_unknown',
      monthlyRequests: null,
      aiUsdCents: null,
      aiKzt: null,
      externalProviderFees: [],
    },
  },
  calculatedAt: '2026-11-07T10:00:00.000Z',
};

const REQUEST: RequestView = {
  id: 'r1',
  analysisId: 'a1',
  scope: 'opportunity',
  status: 'technical_review',
  opportunityTitles: { o1: 'ИИ-консультант по товарам' },
  customerMessage: '',
  contact: { name: 'Айгерим', phone: '+77001234567', email: 'owner@example.com' },
  preliminary: ESTIMATE,
  proposal: null,
  canCancel: true,
  canAccept: false,
  createdAt: '2026-11-07T10:05:00.000Z',
  updatedAt: '2026-11-07T10:05:00.000Z',
};

function installApi(estimate: EstimateView = ESTIMATE) {
  const calls: Array<{
    method: string;
    path: string;
    body: unknown;
    headers: Record<string, string>;
  }> = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({
      method,
      path: url.pathname,
      body,
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    if (url.pathname === '/api/analyses/a1' && method === 'GET') {
      return json(200, {
        analysis: ANALYSIS,
        plans: null,
        rerun: null,
        retry: null,
        estimates: { enabled: true, items: [estimate] },
      });
    }
    if (url.pathname === '/api/analyses/a1/requests' && method === 'POST') {
      return json(201, { request: REQUEST });
    }
    if (url.pathname === '/api/analyses/a1/profile' && method === 'PATCH') {
      return json(200, { analysis: ANALYSIS, estimates: { enabled: true, items: [estimate] } });
    }
    if (url.pathname === '/api/requests' && method === 'GET')
      return json(200, { requests: [REQUEST] });
    if (url.pathname === '/api/requests/r1' && method === 'GET')
      return json(200, { request: REQUEST });
    if (url.pathname === '/api/requests/r1/cancel' && method === 'POST') {
      return json(200, { request: { ...REQUEST, status: 'cancelled', canCancel: false } });
    }
    // Остальное (кредиты в шапке и т. п.) — как на сервере без данных: 404.
    return json(404, { error: { code: 'not_found', message: '' } });
  });
  return calls;
}

function signIn() {
  useAuth.setState({
    status: 'authenticated',
    token: 'mock-token',
    user: {
      id: 'u1',
      email: 'owner@example.com',
      name: 'Айгерим',
      plan: 'credits',
      createdAt: '2026-01-01T00:00:00.000Z',
    } as never,
  });
}

describe('смета внедрения в отчёте и заявка', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    setSiteFeatures({ discovery: true });
  });
  afterEach(() => {
    setSiteFeatures(null);
    vi.unstubAllGlobals();
  });

  it('показывает рассчитанный сервером диапазон, срок, уверенность и что оплачивается отдельно', async () => {
    installApi();
    renderRoute('/analyses/a1');
    const card = (
      await screen.findByRole('heading', { name: 'ИИ-консультант по товарам' })
    ).closest('li')!;
    expect(within(card).getByText('Предварительная стоимость внедрения')).toBeInTheDocument();
    expect(within(card).getByText(/85\s000–145\s000\s₸/)).toBeInTheDocument();
    expect(within(card).getByText('Ориентировочный срок: 4–9 рабочих дней')).toBeInTheDocument();
    expect(within(card).getByText('Оценка приблизительная')).toBeInTheDocument();
    expect(within(card).getAllByText('Требуется техническая проверка').length).toBeGreaterThan(0);
    expect(within(card).getByText('Помощник')).toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: 'Из чего складывается стоимость' }));
    expect(within(card).getByText('В стоимость входит')).toBeVisible();
    expect(within(card).getByText(/Обмен заказами с CRM через её API/)).toBeVisible();
    expect(within(card).getByText('Отдельно оплачивается')).toBeVisible();
    // Работа команды — только на платном тарифе; тариф — с сервера, прежней подписки $15 нет.
    expect(
      within(card).getByText('Работа по интеграциям доступна только на платном тарифе.'),
    ).toBeVisible();
    expect(
      within(card).getByText(/Тариф Growth: \$29 в месяц, до 5\s000 обращений\./),
    ).toBeVisible();
    expect(card.textContent).not.toMatch(/\$15|7\s500 кредитов/);
    expect(within(card).getByText(/зависит от числа обращений/)).toBeVisible();
    expect(
      within(card).getByText(
        /Это предварительная оценка, а не окончательное коммерческое предложение/,
      ),
    ).toBeVisible();
    expect(within(card).getByText(/её срок от нас не зависит/)).toBeVisible();
    // Профиль бизнеса виден и правится.
    expect(screen.getByText('Профиль бизнеса')).toBeInTheDocument();
    expect(screen.getByText('Караганда')).toBeInTheDocument();
  });

  it('гостю предлагает войти, а не делает вид, что заявка отправлена', async () => {
    const calls = installApi();
    renderRoute('/analyses/a1');
    const card = (
      await screen.findByRole('heading', { name: 'ИИ-консультант по товарам' })
    ).closest('li')!;
    fireEvent.click(within(card).getByRole('button', { name: 'Запросить точную смету' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'Войти' })).toHaveAttribute(
      'href',
      '/login?redirect=%2Fanalyses%2Fa1',
    );
    expect(calls.some((call) => call.path.endsWith('/requests'))).toBe(false);
  });

  it('после входа отправляет заявку со сметой и ключом идемпотентности, показывает статус сервера', async () => {
    signIn();
    const calls = installApi();
    renderRoute('/analyses/a1');
    const card = (
      await screen.findByRole('heading', { name: 'ИИ-консультант по товарам' })
    ).closest('li')!;
    fireEvent.click(within(card).getByRole('button', { name: 'Запросить точную смету' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить заявку' }));
    expect(await within(dialog).findByText('Укажите номер телефона')).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST' && call.path.endsWith('/requests'))).toBe(
      false,
    );

    fireEvent.change(within(dialog).getByLabelText('Телефон или WhatsApp'), {
      target: { value: '+7 700 123 45 67' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить заявку' }));
    expect(await within(dialog).findByText('Заявка отправлена')).toBeInTheDocument();
    expect(within(dialog).getByText(/Техническая проверка/)).toBeInTheDocument();
    const post = calls.find(
      (call) => call.method === 'POST' && call.path === '/api/analyses/a1/requests',
    )!;
    expect(post.body).toEqual({
      scopeKey: 'opp:o1',
      message: '',
      contact: { name: 'Айгерим', phone: '+7 700 123 45 67' },
    });
    expect(post.headers['Idempotency-Key']).toMatch(/^[A-Za-z0-9_-]{8,}$/);
    expect(within(dialog).getByRole('link', { name: 'Открыть заявку' })).toHaveAttribute(
      'href',
      '/requests/r1',
    );
  });

  it('«Мои заявки»: список, снимок сметы и отмена', async () => {
    signIn();
    installApi();
    renderRoute('/requests');
    expect(await screen.findByText('ИИ-консультант по товарам')).toBeInTheDocument();
    expect(screen.getByText('Техническая проверка')).toBeInTheDocument();

    renderRoute('/requests/r1');
    expect(await screen.findByText('Предварительная оценка')).toBeInTheDocument();
    expect(screen.getByText(/не меняется при изменении цен/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить заявку' }));
    await waitFor(() => expect(screen.getAllByText('Отменено').length).toBeGreaterThan(0));
  });

  it('карточка «сами в Ketner»: без цены в тенге, без сроков и без заявки на смету', async () => {
    installApi({
      ...ESTIMATE,
      priceKzt: null,
      workingDays: null,
      externalApproval: false,
      delivery: {
        kind: 'self_service',
        plannedWork: [],
        teamWork: [],
        priceList: { status: 'unknown', limitChars: 8000, maxPositions: 100, positions: null },
        paidTierRequired: false,
        tier: { id: 'start', name: 'Start', priceUsd: 10, monthlyRequests: 1000 },
        volumeKnown: true,
      },
    });
    renderRoute('/analyses/a1');
    const card = (
      await screen.findByRole('heading', { name: 'ИИ-консультант по товарам' })
    ).closest('li')!;
    const self = within(card).getByTestId('estimate-self-service');
    expect(within(self).getByText('Можно сделать самим в Ketner')).toBeInTheDocument();
    expect(self).toHaveTextContent(/если он помещается в 8\s000 символов \(примерно 100 позиций\)/);
    expect(self).toHaveTextContent(/Тариф Start: \$10 в месяц, до 1\s000 обращений\./);
    expect(card.textContent).not.toMatch(/₸|рабочих дней|Предварительная стоимость/);
    expect(within(card).queryByRole('button', { name: 'Запросить точную смету' })).toBeNull();
    expect(
      within(card).queryByRole('button', { name: 'Из чего складывается стоимость' }),
    ).toBeNull();
  });

  it('прайс-лист больше лимита знаний: карточка говорит, что вставить нельзя, и называет следующий шаг', async () => {
    installApi({
      ...ESTIMATE,
      delivery: {
        ...ESTIMATE.delivery,
        teamWork: ['Подготовка каталога товаров и услуг'],
        priceList: { status: 'too_large', limitChars: 8000, maxPositions: 100, positions: 1200 },
        paidTierRequired: true,
      },
    });
    renderRoute('/analyses/a1');
    const card = (
      await screen.findByRole('heading', { name: 'ИИ-консультант по товарам' })
    ).closest('li')!;
    expect(card).toHaveTextContent(
      /Прайс-лист слишком большой, чтобы вставить его в знания помощника/,
    );
    expect(card).toHaveTextContent(
      /Следующий шаг: сократите его до основных позиций или закажите подготовку каталога командой\./,
    );
  });

  it('«запланировано» (WhatsApp): без цены, без оценки команды и без заявки', async () => {
    installApi({
      ...ESTIMATE,
      priceKzt: null,
      workingDays: null,
      externalApproval: false,
      delivery: {
        kind: 'planned',
        plannedWork: ['Подключение WhatsApp Business'],
        teamWork: [],
        priceList: null,
        paidTierRequired: false,
        tier: null,
        volumeKnown: false,
      },
    });
    renderRoute('/analyses/a1');
    const card = (
      await screen.findByRole('heading', { name: 'ИИ-консультант по товарам' })
    ).closest('li')!;
    const planned = within(card).getByTestId('estimate-planned');
    expect(within(planned).getByText('Запланировано — пока без цены')).toBeInTheDocument();
    expect(planned).toHaveTextContent(/Этого в Ketner пока нет: Подключение WhatsApp Business\./);
    expect(card.textContent).not.toMatch(/₸|рабочих дней/);
    expect(within(card).queryByRole('button', { name: 'Запросить точную смету' })).toBeNull();
  });
});
