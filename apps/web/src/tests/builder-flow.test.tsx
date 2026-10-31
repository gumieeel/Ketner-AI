import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import type {
  AssistantConfig,
  ChatMessage,
  SolutionDetails,
  TestRunView,
} from '@/features/builder/api';
import { setSiteFeatures } from '@/lib/features';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';

function signIn(): void {
  useAuth.setState({
    status: 'authenticated',
    token: 'mock-token',
    user: {
      id: 'u1',
      email: 'owner@example.com',
      name: 'Owner',
      plan: 'credits',
      createdAt: '2026-01-01T00:00:00.000Z',
    } as never,
  });
}

const CONFIG: AssistantConfig = {
  name: 'Ответы покупателям',
  purpose: 'Отвечает на вопросы о доставке',
  instructions: 'Отвечай кратко.',
  tone: 'friendly',
  knowledge: 'Доставка 3 дня.',
  examples: [],
  restrictions: ['Не обещать скидки'],
  language: 'ru',
};

const PASSED_RUN: TestRunView = {
  id: 'r1',
  versionNumber: 1,
  status: 'done',
  chargedCredits: 4,
  createdAt: '2026-10-31T10:00:00.000Z',
  finishedAt: '2026-10-31T10:01:00.000Z',
  results: [
    {
      caseId: 'c1',
      input: 'Сколько ехать заказу?',
      criteria: ['Называет срок 3 дня'],
      status: 'done',
      answer: 'Доставка занимает 3 дня.',
      model: { id: 'ketner-pro', name: 'MiMo-V2.6 Pro' },
      judge: {
        verdict: 'fail',
        notes: '',
        criteria: [{ criterion: 'Называет срок 3 дня', met: false, note: 'Нет срока' }],
      },
      manual: null,
      error: null,
      chargedCredits: 4,
    },
  ],
};

function details(patch: Partial<SolutionDetails> = {}): SolutionDetails {
  return {
    solution: {
      id: 's1',
      type: 'assistant',
      status: 'draft',
      name: CONFIG.name,
      currentVersion: 1,
      activeVersion: null,
      source: { analysisId: 'a1', opportunityId: 'o1', title: 'Черновики ответов' },
      createdAt: '2026-10-31T10:00:00.000Z',
      updatedAt: '2026-10-31T10:00:00.000Z',
    },
    config: CONFIG,
    versions: [{ number: 1, createdAt: '2026-10-31T10:00:00.000Z' }],
    cases: [
      {
        id: 'c1',
        position: 0,
        input: 'Сколько ехать заказу?',
        criteria: ['Называет срок 3 дня'],
        createdAt: '2026-10-31T10:00:00.000Z',
        updatedAt: '2026-10-31T10:00:00.000Z',
      },
    ],
    run: null,
    readiness: { ready: false, reason: 'not_tested' },
    testQuote: { cases: 1, judgeModel: 'MiMo-V2.6 Pro', typicalCredits: 4, maxCredits: 38 },
    ...patch,
  };
}

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

function installBuilderApi(initial: SolutionDetails) {
  const calls: Call[] = [];
  let state = initial;
  const messages: ChatMessage[] = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, path: url.pathname, body });
    const path = url.pathname.replace(/^\/api\/solutions/, '');
    if (path === '' && method === 'GET') return json(200, { solutions: [state.solution] });
    if (path === '/s1' && method === 'GET') return json(200, state);
    if (path === '/s1/config') {
      state = {
        ...state,
        config: body?.config as AssistantConfig,
        solution: { ...state.solution, currentVersion: state.solution.currentVersion + 1 },
        versions: [
          { number: state.solution.currentVersion + 1, createdAt: '2026-10-31T11:00:00.000Z' },
          ...state.versions,
        ],
        readiness: { ready: false, reason: 'outdated' },
      };
      return json(200, state);
    }
    if (path === '/s1/test-runs') {
      state = {
        ...state,
        run: PASSED_RUN,
        readiness: { ready: false, reason: 'failed_cases', failed: 1 },
      };
      return json(202, { run: PASSED_RUN });
    }
    if (path.startsWith('/s1/test-runs/r1/cases/c1')) {
      const run = state.run!;
      state = {
        ...state,
        run: { ...run, results: [{ ...run.results[0], manual: body?.verdict as 'pass' }] },
        readiness: body?.verdict === 'pass' ? { ready: true } : state.readiness,
      };
      return json(200, state);
    }
    if (path === '/s1/activate') {
      state = {
        ...state,
        solution: {
          ...state.solution,
          status: 'active',
          activeVersion: state.solution.currentVersion,
        },
      };
      return json(200, state);
    }
    if (path === '/s1/threads' && method === 'GET') return json(200, { threads: [] });
    if (path === '/s1/threads' && method === 'POST') {
      return json(201, {
        thread: {
          id: 't1',
          solutionId: 's1',
          title: 'Новый чат',
          createdAt: '2026-10-31T10:00:00.000Z',
          updatedAt: '2026-10-31T10:00:00.000Z',
        },
      });
    }
    if (path === '/s1/threads/t1/messages' && method === 'GET') return json(200, { messages });
    if (path === '/s1/threads/t1/messages' && method === 'POST') {
      const user: ChatMessage = {
        id: `m${messages.length}`,
        threadId: 't1',
        role: 'user',
        content: String(body?.content),
        model: null,
        image: null,
        status: 'complete',
        createdAt: '2026-10-31T10:00:00.000Z',
      };
      const answer: ChatMessage = {
        ...user,
        id: `m${messages.length + 1}`,
        role: 'assistant',
        content: 'Доставка занимает 3 дня.',
        model: { id: 'ketner-pro', name: 'MiMo-V2.6 Pro' },
      };
      messages.push(user, answer);
      const stream =
        `event: delta\ndata: ${JSON.stringify({ content: 'Доставка занимает' })}\n\n` +
        `event: delta\ndata: ${JSON.stringify({ content: ' 3 дня.' })}\n\n` +
        `event: done\ndata: ${JSON.stringify({ message: answer, chargedCredits: 2.4 })}\n\n`;
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    return json(404, { error: { code: 'not_found', message: '' } });
  });
  return { calls };
}

describe('Builder: помощник — настройки, проверка, включение, чат', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    setSiteFeatures({ discovery: true });
  });
  afterEach(() => {
    setSiteFeatures(null);
    vi.unstubAllGlobals();
  });

  it('без входа Builder предлагает войти', () => {
    renderRoute('/solutions');
    const main = screen.getByRole('heading', { level: 1, name: 'Помощники' }).closest('section')!;
    expect(within(main).getByRole('link', { name: 'Войти' })).toHaveAttribute(
      'href',
      '/login?redirect=%2Fsolutions',
    );
  });

  it('настройки сохраняются новой версией; без проверки включить нельзя', async () => {
    signIn();
    const api = installBuilderApi(details());
    renderRoute('/solutions/s1');
    expect(await screen.findByRole('heading', { level: 1, name: CONFIG.name })).toBeVisible();
    expect(screen.getByText(/Модель не выбирается вручную/)).toBeVisible();
    expect(
      screen.getByText('Проверьте помощника на тест-кейсах — после этого его можно включить.'),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Включить помощника' })).toBeNull();

    const save = screen.getByRole('button', { name: 'Сохранить как новую версию' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Как работать' }), {
      target: { value: 'Отвечай кратко и вежливо.' },
    });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(await screen.findByText('Сохранено: версия 2.')).toBeVisible();
    expect(api.calls.find((call) => call.path === '/api/solutions/s1/config')?.body).toMatchObject({
      config: { instructions: 'Отвечай кратко и вежливо.' },
    });
  });

  it('проверка: цена до запуска, вердикт судьи, засчитать вручную, затем включить', async () => {
    signIn();
    const api = installBuilderApi(details());
    renderRoute('/solutions/s1');
    await screen.findByRole('heading', { level: 1, name: CONFIG.name });
    expect(
      screen.getByText(
        'Кейсов: 1. Стоимость: ≈ 4, не больше 38 кредитов · проверяет MiMo-V2.6 Pro.',
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить на тест-кейсах' }));
    expect(await screen.findByText('Не пройден')).toBeVisible();
    expect(api.calls.find((call) => call.path === '/api/solutions/s1/test-runs')?.body).toEqual({
      confirm: true,
    });
    expect(screen.getByText(/Не пройдено кейсов: 1/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Засчитать' }));
    expect(await screen.findByText('Пройден · вручную')).toBeVisible();
    fireEvent.click(await screen.findByRole('button', { name: 'Включить помощника' }));
    expect(await screen.findByText('Помощник включён и работает на текущей версии.')).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'Открыть чат' })[0]).toHaveAttribute(
      'href',
      '/solutions/s1/chat',
    );
  });

  it('чат помощника: без выбора модели, ответ потоком, видно, какая модель ответила', async () => {
    signIn();
    installBuilderApi(
      details({
        solution: { ...details().solution, status: 'active', activeVersion: 1 },
        readiness: { ready: true },
      }),
    );
    renderRoute('/solutions/s1/chat');
    const input = await screen.findByRole('textbox', { name: 'Сообщение помощнику' });
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.change(input, { target: { value: 'Сколько ехать заказу?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(
      await screen.findByText('Ответила модель: MiMo-V2.6 Pro · подобрана автоматически'),
    ).toBeVisible();
    expect(screen.getByText('Списано за ответ: 2,4 кредита')).toBeVisible();
    const list = screen.getByRole('navigation', { name: 'Чаты помощника' });
    await waitFor(() =>
      expect(within(list).getByRole('button')).toHaveTextContent('Сколько ехать заказу?'),
    );
  });

  it('выключенный помощник: чат недоступен, ведёт в настройки', async () => {
    signIn();
    installBuilderApi(details());
    renderRoute('/solutions/s1/chat');
    expect(await screen.findByText('Помощник выключен — чат недоступен.')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Сообщение помощнику' })).toBeDisabled();
  });
});
