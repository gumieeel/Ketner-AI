import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisView, Offer, Question } from '@/features/discovery/api';
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
      title: 'Черновики ответов',
      problem: 'Однотипные вопросы',
      solution: 'ИИ пишет черновик, вы проверяете',
      firstStep: 'Соберите 10 частых вопросов',
      effort: 'low',
      feasibilityStatus: 'ready',
      impact: { kind: 'qualitative', benefit: 'Быстрее отвечать' },
      priority: 0,
    },
    {
      id: 'o2',
      title: 'Автоответы в почте',
      problem: 'Однотипные письма',
      solution: 'ИИ отвечает сам',
      firstStep: '',
      effort: 'high',
      feasibilityStatus: 'not_supported',
      impact: { kind: 'estimate', hoursPerWeek: [2, 4], benefit: 'Меньше ручных ответов' },
      priority: 1,
    },
  ],
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
}) {
  const calls: Call[] = [];
  const state = { view: options.view ?? null };
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
      });
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
    expect(await screen.findByRole('heading', { name: 'Несколько уточнений' })).toBeInTheDocument();
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

  it('вопросы: черновик сохраняется на сервере и возвращается после перезагрузки', async () => {
    const api = installDiscoveryApi({ view: analysis() });
    const first = renderRoute('/analyses/a1');
    const field = await screen.findByRole('textbox', { name: /Где сейчас хранятся заказы/ });
    expect(screen.getByText('Зачем: От этого зависят интеграции')).toBeInTheDocument();
    expect(screen.getByText('необязательно')).toBeInTheDocument();

    fireEvent.change(field, { target: { value: 'В Google Таблицах' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Мессенджеры' }));
    await waitFor(() => expect(screen.getByText('Ответы сохранены')).toBeInTheDocument(), {
      timeout: 3000,
    });
    const put = api.calls.filter((call) => call.method === 'PUT').at(-1);
    expect(put?.body).toEqual({
      answers: { q1: { value: 'В Google Таблицах' }, q2: { value: 'Мессенджеры' } },
    });
    // Модель не вызывалась: только черновик.
    expect(api.calls.some((call) => call.path.endsWith('/continue'))).toBe(false);

    first.unmount();
    renderRoute('/analyses/a1');
    expect(await screen.findByRole('textbox', { name: /Где сейчас хранятся заказы/ })).toHaveValue(
      'В Google Таблицах',
    );
    expect(screen.getByRole('radio', { name: 'Мессенджеры' })).toBeChecked();
  });

  it('обязательный вопрос: ответить или пропустить; пропуск можно отменить', async () => {
    const api = installDiscoveryApi({ view: analysis() });
    renderRoute('/analyses/a1');
    const submit = await screen.findByRole('button', { name: 'Продолжить анализ' });

    fireEvent.click(submit);
    expect(screen.getAllByText('Ответьте на вопрос или пропустите его.').length).toBeGreaterThan(0);
    expect(api.calls.some((call) => call.path.endsWith('/continue'))).toBe(false);

    fireEvent.click(
      screen.getByRole('button', { name: 'Пропустить: Где сейчас хранятся заказы?' }),
    );
    expect(screen.queryByRole('textbox', { name: /Где сейчас хранятся заказы/ })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ответить' })[0]);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Пропустить: Где сейчас хранятся заказы?' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить анализ' }));

    expect(await screen.findByRole('heading', { name: 'Где ИИ поможет' })).toBeInTheDocument();
    const sent = api.calls.find((call) => call.path.endsWith('/continue'));
    expect(sent?.body).toEqual({ answers: { q1: { skipped: true } } });
  });

  it('результат: возможности со статусом реализуемости, цена; правка ответов — только при изменении и с ценой', async () => {
    const api = installDiscoveryApi({
      view: analysis({ ...READY_PATCH, guest: false }),
      rerun: { model: 'GPT-6 Luna', typicalCredits: 2, maxCredits: 7, loginRequired: false },
    });
    renderRoute('/analyses/a1');

    expect(await screen.findByRole('heading', { name: 'Где ИИ поможет' })).toBeInTheDocument();
    expect(screen.getByText('Бесплатный анализ — кредиты не списаны.')).toBeInTheDocument();
    const cards = screen
      .getAllByRole('listitem')
      .filter((item) => within(item).queryByRole('heading'));
    expect(cards.map((card) => within(card).getByRole('heading').textContent)).toEqual([
      'Черновики ответов',
      'Автоответы в почте',
    ]);
    expect(within(cards[0]).getByText('Можно сделать сейчас')).toBeInTheDocument();
    expect(within(cards[1]).getByText('Пока не поддерживается')).toBeInTheDocument();
    expect(within(cards[1]).getByText(/≈ 2–4 ч в неделю/)).toBeInTheDocument();
    // Шаги: всё готово, модель названа настоящим именем.
    expect(screen.getAllByText('готово · GPT-6 Luna')).toHaveLength(2);

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
    expect(await screen.findByRole('heading', { name: 'Где ИИ поможет' })).toBeInTheDocument();
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
