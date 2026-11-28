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

function installApi(
  estimate: EstimateView = ESTIMATE,
  patch: Partial<AnalysisView> = {},
  paidTier = false,
) {
  const analysis = { ...ANALYSIS, ...patch };
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
        analysis,
        plans: null,
        rerun: null,
        retry: null,
        paidTier,
        // Старый сервер ещё присылал сметы: отчёт их не показывает.
        estimates: { enabled: true, items: [estimate] },
      });
    }
    if (url.pathname === '/api/analyses/a1/requests' && method === 'POST') {
      return json(201, { request: REQUEST });
    }
    if (url.pathname === '/api/analyses/a1/profile' && method === 'PATCH') {
      return json(200, { analysis, paidTier });
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

describe('отчёт без разовых смет; статус «С командой Ketner»; «Мои заявки»', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    setSiteFeatures({ discovery: true });
  });
  afterEach(() => {
    setSiteFeatures(null);
    vi.unstubAllGlobals();
  });

  it('разовых смет в отчёте нет ни у кого: ни цены, ни «смет», ни «Если внедрять вместе», ни заявки', async () => {
    signIn();
    // Даже если старый сервер прислал сметы — отчёт их не показывает.
    installApi();
    renderRoute('/analyses/a1');
    await screen.findByRole('heading', { name: 'ИИ-консультант по товарам' });
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\d[\d\s\u00a0]*₸/);
    expect(text).not.toMatch(/\$\s?\d/);
    const at = text.search(/смет/i);
    expect(at === -1 ? '' : text.slice(Math.max(0, at - 60), at + 60)).toBe('');
    expect(text).not.toMatch(
      /Если внедрять вместе|Дешевле, чем по отдельности|Из чего складывается/,
    );
    expect(text).not.toMatch(/Предварительная стоимость|Запросить/);
  });

  it('«С командой Ketner»: без цены; с тарифом — «Обсудить с командой», без тарифа — требование тарифа', async () => {
    signIn();
    const team = { ...ANALYSIS.opportunities[0]!, launch: 'team' as const };
    installApi(ESTIMATE, { opportunities: [team] }, true);
    renderRoute('/analyses/a1');
    const card = (
      await screen.findByRole('heading', { name: 'ИИ-консультант по товарам' })
    ).closest('li')!;
    expect(within(card).getAllByText('С командой Ketner')[0]).toBeVisible();
    expect(within(card).getByRole('link', { name: 'Обсудить с командой' })).toHaveAttribute(
      'href',
      '/contacts',
    );
    expect(within(card).queryByText(/₸/)).toBeNull();
    expect(within(card).queryByTestId('self-service')).toBeNull();
  });

  it('«С командой Ketner» без платного тарифа: требование тарифа и ссылка на тарифы', async () => {
    signIn();
    const team = { ...ANALYSIS.opportunities[0]!, launch: 'team' as const };
    installApi(ESTIMATE, { opportunities: [team] }, false);
    renderRoute('/analyses/a1');
    const again = (
      await screen.findByRole('heading', { name: 'ИИ-консультант по товарам' })
    ).closest('li')!;
    expect(within(again).getByText(/Доступно на платном тарифе\./)).toBeVisible();
    expect(within(again).getByRole('link', { name: 'Тарифы' })).toHaveAttribute('href', '/pricing');
    expect(within(again).queryByRole('link', { name: 'Обсудить с командой' })).toBeNull();
  });

  it('один статус для счётчика, метки и блоков: «сейчас» — блок «сами», «скоро» — без него', async () => {
    signIn();
    const base = ANALYSIS.opportunities[0]!;
    installApi(ESTIMATE, {
      opportunities: [
        { ...base, id: 'o1', title: 'Агент на сайте', recipe: 'customer_bot', launch: 'now' },
        {
          ...base,
          id: 'o2',
          title: 'Сделки в amoCRM',
          launch: 'soon',
          requires: ['crm'],
          feasibilityStatus: 'not_supported',
          feasibility: {
            status: 'not_supported',
            blockers: [{ capability: 'crm', label: 'CRM', hint: '', status: 'not_supported' }],
            available: [],
          },
        },
        // Выполнимо, но готовой автоматизации нет — «скоро», не «можно сделать самим».
        { ...base, id: 'o3', title: 'Черновики писем', launch: 'soon' },
      ],
    });
    renderRoute('/analyses/a1');
    const card = async (title: string) =>
      (await screen.findByRole('heading', { name: title })).closest('li')!;
    const now = await card('Агент на сайте');
    expect(within(now).getByText('Запускается сейчас')).toBeVisible();
    expect(within(now).getByTestId('self-service')).toBeVisible();
    expect(within(now).getByText('ИИ-агент для клиентов')).toBeVisible();
    const crm = await card('Сделки в amoCRM');
    expect(within(crm).getByText('Скоро')).toBeVisible();
    expect(within(crm).getByText(/Ketner пока не умеет этого сам: CRM/)).toBeVisible();
    expect(within(crm).queryByTestId('self-service')).toBeNull();
    const drafts = await card('Черновики писем');
    expect(within(drafts).getByText('Скоро')).toBeVisible();
    expect(within(drafts).queryByTestId('self-service')).toBeNull();
    expect(within(drafts).queryByText('Запускается сейчас')).toBeNull();
    // Счётчик — по тому же статусу: одна «сейчас» из трёх.
    expect(screen.getByText('1 из 3')).toBeVisible();
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
});
