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
    delete (window as unknown as { google?: unknown }).google;
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

  it('на экране согласия сняли «Google Диск»: понятная причина и «Подключить снова»', async () => {
    setProductSwitchesForTests({ googleSheets: true });
    window.history.replaceState(null, '', '/solutions/b1#google_code=c-2&google_state=s-2');
    const calls = cabinet((call) => {
      if (call.path === '/api/integrations/google/confirm') {
        return json(400, {
          error: {
            code: 'google_missing_drive_file',
            message:
              'Вы не дали доступ к Google Диску. Нажмите «Подключить снова» и отметьте доступ к файлам.',
          },
        });
      }
      if (call.path.split('?')[0] === '/api/integrations/google') {
        return json(200, { ...CONNECTED, connected: false, status: null, pending: 0 });
      }
      if (call.path.startsWith('/api/integrations/google/deliveries'))
        return json(200, { states: {} });
      if (call.path === '/api/integrations/google/start') {
        return json(503, { error: { code: 'unavailable', message: 'нет' } });
      }
      return null;
    });
    renderRoute('/solutions/b1');
    const reason = await screen.findByText(
      'Вы не дали доступ к Google Диску. Нажмите «Подключить снова» и отметьте доступ к файлам.',
    );
    expect(reason).toHaveAttribute('role', 'alert');
    fireEvent.click(screen.getByRole('button', { name: 'Подключить снова' }));
    await waitFor(() =>
      expect(calls.some((call) => call.path === '/api/integrations/google/start')).toBe(true),
    );
  });

  /** Поддельный Google Picker: выбирает `pickedId` (null — закрыть окно), запоминает настройки. */
  function fakePicker(pickedId: string | null) {
    const seen: Record<string, string> = {};
    class Builder {
      private callback: (data: { action: string; docs?: Array<{ id: string }> }) => void = () => {};
      addView() {
        return this;
      }
      setOAuthToken(token: string) {
        seen.token = token;
        return this;
      }
      setDeveloperKey(key: string) {
        seen.key = key;
        return this;
      }
      setAppId(appId: string) {
        seen.appId = appId;
        return this;
      }
      setLocale(locale: string) {
        seen.locale = locale;
        return this;
      }
      setTitle(title: string) {
        seen.title = title;
        return this;
      }
      setCallback(callback: Builder['callback']) {
        this.callback = callback;
        return this;
      }
      build() {
        return {
          setVisible: () =>
            queueMicrotask(() =>
              this.callback(
                pickedId ? { action: 'picked', docs: [{ id: pickedId }] } : { action: 'cancel' },
              ),
            ),
        };
      }
    }
    (window as unknown as { google: unknown }).google = {
      picker: {
        PickerBuilder: Builder,
        DocsView: class {
          setMode() {
            return this;
          }
        },
        ViewId: { SPREADSHEETS: 'spreadsheets' },
        DocsViewMode: { LIST: 'list' },
        Action: { PICKED: 'picked', CANCEL: 'cancel' },
      },
    };
    return seen;
  }

  const OLD_URL = 'https://docs.google.com/spreadsheets/d/old-sheet-0123456789/edit';
  const LOST = {
    ...CONNECTED,
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/new-sheet-0123456789/edit',
    previousSheetUrl: OLD_URL,
    picker: true,
    pending: 0,
  };

  it('после переподключения прежняя таблица недоступна: сообщение, ссылка, выбор в Google Picker', async () => {
    setProductSwitchesForTests({ googleSheets: true });
    const seen = fakePicker('old-sheet-0123456789');
    let status: Record<string, unknown> = LOST;
    const calls = cabinet((call) => {
      if (call.path.split('?')[0] === '/api/integrations/google') return json(200, status);
      if (call.path.startsWith('/api/integrations/google/deliveries'))
        return json(200, { states: {} });
      if (call.path === '/api/integrations/google/picker-token') {
        return json(200, {
          accessToken: 'ya29.short',
          apiKey: 'AIza-key',
          appId: '123456789012',
        });
      }
      if (call.path === '/api/integrations/google/pick-sheet') {
        status = { ...CONNECTED, spreadsheetUrl: OLD_URL, previousSheetUrl: null, picker: true };
        return json(200, status);
      }
      return null;
    });
    renderRoute('/solutions/b1');

    const notice = await screen.findByTestId('google-previous-sheet');
    expect(notice).toHaveTextContent('Прежняя таблица больше недоступна Ketner');
    expect(notice).toHaveTextContent('Прежняя таблица осталась в вашем Google Диске');
    expect(screen.getByRole('link', { name: 'Открыть прежнюю таблицу' })).toHaveAttribute(
      'href',
      OLD_URL,
    );
    // Основная ссылка — на новую таблицу, куда идут заявки.
    expect(screen.getByRole('link', { name: 'Открыть таблицу' })).toHaveAttribute(
      'href',
      LOST.spreadsheetUrl,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать прежнюю таблицу' }));
    expect(
      await screen.findByText(
        'Заявки снова пишутся в прежнюю таблицу. То, что успело записаться в новую, осталось в ней.',
      ),
    ).toBeVisible();
    expect(seen).toMatchObject({
      token: 'ya29.short',
      key: 'AIza-key',
      appId: '123456789012',
      locale: 'ru',
      title: 'Выберите таблицу «Заявки Ketner»',
    });
    expect(calls.find((call) => call.path.endsWith('/pick-sheet'))?.body).toEqual({
      spreadsheetId: 'old-sheet-0123456789',
    });
    await waitFor(() => expect(screen.queryByTestId('google-previous-sheet')).toBeNull());
    expect(screen.getByRole('link', { name: 'Открыть таблицу' })).toHaveAttribute('href', OLD_URL);
  });

  it('выбранный файл не подошёл — причина от сервера; окно закрыли — ничего не меняется; «Понятно»', async () => {
    setProductSwitchesForTests({ googleSheets: true });
    fakePicker(null);
    let status: Record<string, unknown> = LOST;
    const calls = cabinet((call) => {
      if (call.path.split('?')[0] === '/api/integrations/google') return json(200, status);
      if (call.path.startsWith('/api/integrations/google/deliveries'))
        return json(200, { states: {} });
      if (call.path === '/api/integrations/google/picker-token') {
        return json(200, { accessToken: 'ya29.short', apiKey: 'AIza-key', appId: '1234567' });
      }
      if (call.path === '/api/integrations/google/pick-sheet') {
        return json(422, {
          error: {
            code: 'sheet_wrong_header',
            message: 'В этой таблице нет листа «Заявки» с колонками Ketner.',
          },
        });
      }
      if (call.path === '/api/integrations/google/previous-sheet/dismiss') {
        status = { ...LOST, previousSheetUrl: null };
        return json(200, status);
      }
      return null;
    });
    renderRoute('/solutions/b1');
    await screen.findByTestId('google-previous-sheet');

    // Окно закрыли без выбора: на сервер ничего не ушло.
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать прежнюю таблицу' }));
    await waitFor(() =>
      expect(calls.filter((call) => call.path.endsWith('/picker-token')).length).toBe(1),
    );
    expect(calls.some((call) => call.path.endsWith('/pick-sheet'))).toBe(false);

    fakePicker('other-sheet-0123456789');
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать прежнюю таблицу' }));
    expect(
      await screen.findByText('В этой таблице нет листа «Заявки» с колонками Ketner.'),
    ).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Понятно' }));
    await waitFor(() => expect(screen.queryByTestId('google-previous-sheet')).toBeNull());
    expect(calls.some((call) => call.path.endsWith('/previous-sheet/dismiss'))).toBe(true);
  });

  it('Picker не настроен — только ссылка на прежнюю таблицу; Google закрыл доступ — текст про доступ', async () => {
    setProductSwitchesForTests({ googleSheets: true });
    let status: Record<string, unknown> = { ...LOST, picker: false };
    cabinet((call) => {
      if (call.path.split('?')[0] === '/api/integrations/google') return json(200, status);
      if (call.path.startsWith('/api/integrations/google/deliveries'))
        return json(200, { states: {} });
      return null;
    });
    const view = renderRoute('/solutions/b1');
    await screen.findByTestId('google-previous-sheet');
    expect(screen.queryByRole('button', { name: 'Выбрать прежнюю таблицу' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Открыть прежнюю таблицу' })).toBeVisible();
    view.unmount();

    status = {
      ...CONNECTED,
      status: 'sheet_missing',
      lastErrorCode: 'not_found',
      spreadsheetUrl: OLD_URL,
      picker: true,
    };
    renderRoute('/solutions/b1');
    expect(await screen.findByText(/Ketner больше не может открыть таблицу/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Выбрать прежнюю таблицу' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Создать новую таблицу' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Открыть прежнюю таблицу' })).toHaveAttribute(
      'href',
      OLD_URL,
    );
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
