import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import type { BotOverview, SolutionDetails } from '@/features/builder/api';
import { setSiteFeatures } from '@/lib/features';
import { setProductSwitchesForTests } from '@/lib/product-switches';
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

function stubFetch(handler: (call: Call) => Response | null) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const call = {
      method: (init.method ?? 'GET').toUpperCase(),
      path: url.pathname + url.search,
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
    };
    calls.push(call);
    return handler(call) ?? json(404, { error: { code: 'not_found', message: '' } });
  });
  return calls;
}

const LEAD = (id: string, name: string) => ({
  id,
  solutionId: 'b1',
  conversationId: null,
  name,
  contact: '+7 700',
  question: '',
  status: 'new',
  createdAt: '2026-11-21T10:00:00.000Z',
  updatedAt: '2026-11-21T10:00:00.000Z',
});

/** Кабинет бота с заявками; `google` — ответы /api/integrations/google*. */
function cabinet(google: (call: Call) => Response | null) {
  return stubFetch((call) => {
    const path = call.path.replace(/^\/api\/solutions/, '');
    if (path === '/b1') return json(200, botDetails());
    if (path === '/b1/bot') return json(200, botOverview());
    if (path === '/b1/leads') {
      return json(200, { leads: [LEAD('l1', 'Анна'), LEAD('l2', 'Борис'), LEAD('l3', 'Вера')] });
    }
    if (path === '/b1/conversations') return json(200, { conversations: [] });
    if (call.path.startsWith('/api/integrations/google')) return google(call);
    return null;
  });
}

const CLOSED_RESPONSE = () =>
  json(503, {
    error: {
      code: 'feature_unavailable',
      message: 'Запись заявок в Google Таблицу пока недоступна.',
      details: { feature: 'googleSheets' },
    },
  });

const CONNECTED = {
  connected: true,
  status: 'connected',
  email: 'owner@gmail.com',
  spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/s1/edit',
  lastErrorCode: null,
  connectedAt: '2026-11-21T09:00:00.000Z',
  pending: 1,
};

describe('Google Таблица в кабинете бота (этап F)', () => {
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
    setProductSwitchesForTests({});
    window.history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
  });

  it('пилот (шаг 5a): карточку решает сервер — аккаунту из списка статус, остальным 503', async () => {
    cabinet((call) => {
      if (call.path.split('?')[0] === '/api/integrations/google') return json(200, CONNECTED);
      if (call.path.startsWith('/api/integrations/google/deliveries')) {
        return json(200, { states: { l1: 'written' } });
      }
      return null;
    });
    const pilot = renderRoute('/solutions/b1');
    expect(await screen.findByTestId('google-sheet-card')).toBeVisible();
    expect(await screen.findByText('в таблице')).toBeVisible();
    pilot.unmount();

    const calls = cabinet((call) =>
      call.path.split('?')[0] === '/api/integrations/google' ? CLOSED_RESPONSE() : null,
    );
    renderRoute('/solutions/b1');
    expect(await screen.findByText('Анна', { exact: false })).toBeVisible();
    await waitFor(() =>
      expect(calls.some((call) => call.path.split('?')[0] === '/api/integrations/google')).toBe(
        true,
      ),
    );
    expect(screen.queryByTestId('google-sheet-card')).toBeNull();
    expect(screen.queryByText('Google Таблица')).toBeNull();
    expect(calls.some((call) => call.path.includes('/deliveries'))).toBe(false);
  });

  it('таблица в корзине: «проверить снова» после восстановления возвращает подключение', async () => {
    setProductSwitchesForTests({ googleSheets: true });
    let status: Record<string, unknown> = { ...CONNECTED, status: 'sheet_missing', pending: 1 };
    const calls = cabinet((call) => {
      if (call.path.split('?')[0] === '/api/integrations/google') return json(200, status);
      if (call.path.startsWith('/api/integrations/google/deliveries'))
        return json(200, { states: {} });
      if (call.path === '/api/integrations/google/recheck') {
        status = { ...CONNECTED, pending: 1 };
        return json(200, status);
      }
      return null;
    });
    renderRoute('/solutions/b1');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Я восстановил таблицу — проверить' }),
    );
    expect(await screen.findByText('Таблица снова на месте: заявки пишутся в неё.')).toBeVisible();
    expect(calls.some((call) => call.path === '/api/integrations/google/recheck')).toBe(true);
    expect(await screen.findByRole('button', { name: 'Дописать пропущенные (1)' })).toBeVisible();
  });

  it('закрыто для аккаунта: ни карточки, ни отметок — только один запрос статуса (503)', async () => {
    setProductSwitchesForTests({ googleSheets: false });
    const calls = cabinet((call) =>
      call.path.split('?')[0] === '/api/integrations/google' ? CLOSED_RESPONSE() : null,
    );
    renderRoute('/solutions/b1');
    expect(await screen.findByText('Анна', { exact: false })).toBeVisible();
    await waitFor(() =>
      expect(calls.filter((call) => call.path.startsWith('/api/integrations/google'))).toHaveLength(
        1,
      ),
    );
    expect(screen.queryByTestId('google-sheet-card')).toBeNull();
    expect(screen.queryByText('Google Таблица')).toBeNull();
  });

  it('не подключено: кнопка ведёт на Google с возвратом на эту страницу', async () => {
    setProductSwitchesForTests({ googleSheets: true });
    const assign = vi.fn();
    vi.stubGlobal('location', {
      ...window.location,
      assign,
      href: 'http://localhost/solutions/b1',
      hash: '',
    });
    const calls = cabinet((call) => {
      if (call.path.split('?')[0] === '/api/integrations/google') {
        return json(200, {
          connected: false,
          status: null,
          email: null,
          spreadsheetUrl: null,
          lastErrorCode: null,
          connectedAt: null,
          pending: 0,
        });
      }
      if (call.path.startsWith('/api/integrations/google/deliveries'))
        return json(200, { states: {} });
      if (call.path === '/api/integrations/google/start') {
        return json(200, { url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' });
      }
      return null;
    });
    renderRoute('/solutions/b1');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Записывать заявки в Google Таблицу' }),
    );
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1'),
    );
    expect(calls.find((call) => call.path === '/api/integrations/google/start')?.body).toEqual({
      returnTo: 'http://localhost/solutions/b1',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it('подключено: ссылка на таблицу, отметки у заявок, «повторить» и «дописать пропущенные»', async () => {
    setProductSwitchesForTests({ googleSheets: true });
    const calls = cabinet((call) => {
      if (call.path.split('?')[0] === '/api/integrations/google') return json(200, CONNECTED);
      if (call.path === '/api/integrations/google/deliveries?solutionId=b1') {
        return json(200, { states: { l1: 'written', l2: 'failed', l3: 'waiting' } });
      }
      if (call.path === '/api/integrations/google/leads/l2/retry') {
        return json(200, { result: 'retrying', state: 'written' });
      }
      if (call.path === '/api/integrations/google/backfill') {
        return json(200, { ...CONNECTED, pending: 0, retried: 1 });
      }
      return null;
    });
    renderRoute('/solutions/b1');

    expect(await screen.findByRole('link', { name: 'Открыть таблицу' })).toHaveAttribute(
      'href',
      'https://docs.google.com/spreadsheets/d/s1/edit',
    );
    expect(screen.getByText(/owner@gmail\.com/)).toBeVisible();
    expect(await screen.findByText('в таблице')).toBeVisible();
    expect(screen.getByText('не записано в таблицу')).toBeVisible();
    expect(screen.getByText('ждёт подключения таблицы')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.getAllByText('в таблице')).toHaveLength(2));
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Дописать пропущенные (1)' }));
    await waitFor(() =>
      expect(calls.some((call) => call.path === '/api/integrations/google/backfill')).toBe(true),
    );
    expect(await screen.findByText('Пропущенные заявки отправлены в таблицу.')).toBeVisible();
  });

  it('доступ отозван и таблица удалена: понятные баннеры и действия', async () => {
    setProductSwitchesForTests({ googleSheets: true });
    let status: Record<string, unknown> = {
      ...CONNECTED,
      status: 'reconnect_required',
      pending: 2,
    };
    cabinet((call) => {
      if (call.path.split('?')[0] === '/api/integrations/google') return json(200, status);
      if (call.path.startsWith('/api/integrations/google/deliveries'))
        return json(200, { states: {} });
      if (call.path === '/api/integrations/google/new-sheet') {
        status = { ...CONNECTED, pending: 2 };
        return json(200, status);
      }
      return null;
    });
    const view = renderRoute('/solutions/b1');
    expect(await screen.findByText(/Доступ к Google отозван/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Подключить снова' })).toBeVisible();
    view.unmount();

    status = { ...CONNECTED, status: 'sheet_missing', pending: 2 };
    renderRoute('/solutions/b1');
    expect(await screen.findByText(/Таблица удалена или в корзине/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Создать новую таблицу' }));
    expect(await screen.findByText(/Новая таблица создана/)).toBeVisible();
    expect(await screen.findByRole('button', { name: 'Дописать пропущенные (2)' })).toBeVisible();
  });

  it('возврат от Google: код из фрагмента подтверждается и убирается из адреса; отказ — понятный текст', async () => {
    setProductSwitchesForTests({ googleSheets: true });
    window.history.replaceState(null, '', '/solutions/b1#google_code=c-1&google_state=s-1');
    const calls = cabinet((call) => {
      if (call.path === '/api/integrations/google/confirm') return json(200, CONNECTED);
      if (call.path.split('?')[0] === '/api/integrations/google') return json(200, CONNECTED);
      if (call.path.startsWith('/api/integrations/google/deliveries'))
        return json(200, { states: {} });
      return null;
    });
    const view = renderRoute('/solutions/b1');
    expect(await screen.findByText('Google Таблица подключена.')).toBeVisible();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(calls.find((call) => call.path === '/api/integrations/google/confirm')?.body).toEqual({
      code: 'c-1',
      state: 's-1',
      timeZone,
    });
    // Статус несёт часовой пояс браузера — для дат в таблице.
    expect(
      calls.some(
        (call) => call.path === `/api/integrations/google?timeZone=${encodeURIComponent(timeZone)}`,
      ),
    ).toBe(true);
    expect(window.location.hash).toBe('');
    view.unmount();

    window.history.replaceState(null, '', '/solutions/b1#google_error=denied');
    cabinet((call) => {
      if (call.path.split('?')[0] === '/api/integrations/google') {
        return json(200, { ...CONNECTED, connected: false, status: null, pending: 0 });
      }
      if (call.path.startsWith('/api/integrations/google/deliveries'))
        return json(200, { states: {} });
      return null;
    });
    renderRoute('/solutions/b1');
    expect(
      await screen.findByText('Вы не дали доступ к Google. Таблица не подключена.'),
    ).toBeVisible();
  });
});

/** Бот в кабинете владельца (общие данные тестов кабинета). */
function botDetails(): SolutionDetails {
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
      status: 'active',
      name: 'Лиса',
      currentVersion: 1,
      activeVersion: 1,
      source: null,
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
    },
    config: {
      name: 'Лиса',
      purpose: '',
      instructions: '',
      tone: 'friendly',
      knowledge: '',
      examples: [],
      restrictions: [],
      language: 'ru',
    },
    versions: [{ number: 1, createdAt: '2026-11-01T10:00:00.000Z' }],
    cases: [],
    run: null,
    readiness: { ready: true },
    testQuote: null,
  };
}

function botOverview(): BotOverview {
  const details = botDetails();
  return {
    settings: details.solution.bot!,
    today: { replies: 3, credits: 7, newLeads: 1 },
    publicUrl: 'https://ketner.org/b/lisa-shop',
  };
}
