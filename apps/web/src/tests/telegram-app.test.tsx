import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramAppPage } from '@/pages/telegram-app-page';
import type { MiniAppPayment, MiniAppState } from '@/features/telegram/api';
import type { TelegramWebApp } from '@/features/telegram/webapp';
import { resetPreferences } from './test-utils';

const DAY = 864e5;
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();

function payment(overrides: Partial<MiniAppPayment> = {}): MiniAppPayment {
  return {
    id: 'stars:ch-1',
    method: 'stars',
    planId: 'pro',
    planTitle: 'Pro',
    amount: 1670,
    currency: 'XTR',
    paidAt: new Date(Date.now() - 3600_000).toISOString(),
    status: 'paid',
    recurring: false,
    periodEnd: inDays(12),
    bonusDays: 0,
    chargeId: 'ch-1',
    refund: null,
    refundOption: { kind: 'auto' },
    ...overrides,
  };
}

function makeState(overrides: Partial<MiniAppState> = {}): MiniAppState {
  return {
    user: {
      id: 'u1',
      email: 'anna@example.com',
      name: 'Анна Петрова',
      plan: 'pro',
      isVip: false,
      isAdmin: false,
      createdAt: '2026-09-01T10:00:00Z',
      telegramUsername: 'anna',
      telegramOnly: false,
    },
    subscription: { plan: 'pro', status: 'active', renewsAt: inDays(12) },
    autoRenew: null,
    plans: [
      {
        id: 'plus',
        title: 'Plus',
        priceUsd: 9,
        stars: 460,
        starsUsd: 9.2,
        preview: { mode: 'switch', renewsAt: inDays(30), bonusDays: 33 },
      },
      {
        id: 'pro',
        title: 'Pro',
        priceUsd: 25,
        stars: 1260,
        starsUsd: 25.19,
        preview: { mode: 'extend', renewsAt: inDays(42), bonusDays: 0 },
      },
      {
        id: 'ultra',
        title: 'Ultra',
        priceUsd: 49,
        stars: 2460,
        starsUsd: 49.18,
        preview: { mode: 'switch', renewsAt: inDays(36), bonusDays: 6 },
      },
    ],
    rate: {
      usdPerStar: 0.01999,
      source: 'official',
      updatedAt: '2026-10-13T00:00:00Z',
      market: { usdPerStar: 0.0149, updatedAt: '2026-10-12T00:00:00Z' },
    },
    payments: [payment()],
    prefs: { reminders: true, receipts: true },
    refundPolicy: { hours: 24 },
    pendingRefunds: 0,
    siteUrl: 'https://ketner.org',
    botUsername: 'Robo_kassa_bot',
    ...overrides,
  };
}

function fakeWebApp(overrides: Partial<TelegramWebApp> = {}): TelegramWebApp {
  return {
    initData: 'query_id=1&user=%7B%7D&auth_date=1&hash=abc',
    initDataUnsafe: { user: { id: 1, first_name: 'Анна', language_code: 'ru' } },
    colorScheme: 'dark',
    version: '8.0',
    ready: vi.fn(),
    expand: vi.fn(),
    isVersionAtLeast: () => true,
    openInvoice: vi.fn(),
    openLink: vi.fn(),
    openTelegramLink: vi.fn(),
    BackButton: {
      isVisible: false,
      show: vi.fn(),
      hide: vi.fn(),
      onClick: vi.fn(),
      offClick: vi.fn(),
    },
    ...overrides,
  };
}

type Handler = (
  url: string,
  init: RequestInit & { json?: Record<string, unknown> },
) => Response | Promise<Response> | undefined;

/** Подменяет fetch: обработчик возвращает ответ или undefined (тогда 404). Тела запросов сохраняются. */
function mockApi(handler: Handler) {
  const calls: Array<{
    url: string;
    method: string;
    body?: Record<string, unknown>;
    auth?: string;
  }> = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const json =
      typeof init.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: json,
      auth: (init.headers as Record<string, string> | undefined)?.Authorization,
    });
    const response = await handler(url, { ...init, json });
    return (
      response ?? Response.json({ error: { code: 'not_found', message: url } }, { status: 404 })
    );
  });
  return calls;
}

const linkedSession = (state: MiniAppState) =>
  Response.json({ linked: true, token: 'tok', expiresAt: '', ...state });

describe('кабинет в Telegram (/tg)', () => {
  beforeEach(() => {
    resetPreferences();
    window.history.replaceState(null, '', '/tg');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.Telegram;
  });

  it('вне Telegram предлагает открыть бота', async () => {
    window.Telegram = { WebApp: fakeWebApp({ initData: '' }) };
    render(<TelegramAppPage />);
    expect(await screen.findByText('Кабинет открывается в Telegram')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Открыть бота/ })).toHaveAttribute(
      'href',
      'https://t.me/Robo_kassa_bot',
    );
  });

  it('регистрации в Telegram нет: аккаунт подключается кодом из письма', async () => {
    const app = fakeWebApp();
    window.Telegram = { WebApp: app };
    const calls = mockApi((url) => {
      if (url === '/api/telegram/miniapp/session') {
        return Response.json({
          linked: false,
          telegram: { firstName: 'Анна', username: 'anna' },
          siteUrl: 'https://ketner.org',
        });
      }
      if (url === '/api/telegram/miniapp/email-code')
        return Response.json({ sent: true, expiresAt: Date.now() + 600_000, resendAfterSec: 60 });
      if (url === '/api/telegram/miniapp/email-verify') return linkedSession(makeState());
      return undefined;
    });
    render(<TelegramAppPage />);

    expect(await screen.findByRole('heading', { name: 'Привет, Анна!' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Продолжить с Telegram/ })).not.toBeInTheDocument();

    // Нет аккаунта — регистрация на сайте.
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрируйтесь на ketner.org' }));
    expect(app.openLink).toHaveBeenCalledWith('https://ketner.org/signup');

    fireEvent.change(screen.getByLabelText('Почта'), { target: { value: ' anna@example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Прислать код' }));
    expect(await screen.findByText(/код уже в письме/)).toBeInTheDocument();
    expect(calls.find((call) => call.url.endsWith('/email-code'))?.body).toEqual({
      initData: app.initData,
      email: 'anna@example.com',
    });
    // Повторное письмо — только после паузы.
    expect(screen.getByRole('button', { name: /Ещё раз через \d+ с/ })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Код из письма'), { target: { value: '12a34 56' } });
    fireEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    expect(await screen.findByText(/осталось 12 дн\./)).toBeInTheDocument();
    expect(calls.find((call) => call.url.endsWith('/email-verify'))?.body).toEqual({
      initData: app.initData,
      code: '1234 56',
    });
  });

  it('старый аккаунт, созданный в Telegram, отвязать нельзя', async () => {
    window.Telegram = { WebApp: fakeWebApp() };
    const legacy = makeState({
      user: { ...makeState().user, email: null, telegramOnly: true, plan: 'free', name: 'Анна' },
      subscription: { plan: 'free', status: 'active', renewsAt: null },
      payments: [],
    });
    mockApi((url) => (url === '/api/telegram/miniapp/session' ? linkedSession(legacy) : undefined));
    render(<TelegramAppPage />);
    expect(await screen.findByRole('heading', { name: 'Привет, Анна' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Профиль' }));
    expect(screen.getByText('Аккаунт Telegram')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Отвязать Telegram/ })).not.toBeInTheDocument();
  });

  it('есть аккаунт: вход по почте или код для сайта', async () => {
    const app = fakeWebApp();
    window.Telegram = { WebApp: app };
    const calls = mockApi((url) => {
      if (url === '/api/telegram/miniapp/session') {
        return Response.json({
          linked: false,
          telegram: { firstName: 'Анна', username: 'anna' },
          siteUrl: 'https://ketner.org',
        });
      }
      if (url === '/api/telegram/miniapp/link-code')
        return Response.json({ code: 'K7M2QX', expiresAt: Date.now() + 600_000 });
      if (url === '/api/telegram/miniapp/link') return linkedSession(makeState());
      return undefined;
    });
    render(<TelegramAppPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Другие способы подключения' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Google или GitHub' }));
    fireEvent.click(screen.getByRole('button', { name: 'Получить код' }));
    expect(await screen.findByText('K7M2QX')).toBeInTheDocument();
    expect(screen.getByText(/Действует ещё (9|10):\d\d/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Открыть настройки сайта/ }));
    expect(app.openLink).toHaveBeenCalledWith('https://ketner.org/settings#telegram');

    fireEvent.click(screen.getByRole('radio', { name: 'Почта и пароль' }));
    fireEvent.change(screen.getByLabelText('Почта'), { target: { value: 'anna@example.com' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти и подключить' }));
    expect(await screen.findByText(/осталось 12 дн\./)).toBeInTheDocument();
    expect(calls.find((call) => call.url.endsWith('/link'))?.body).toEqual({
      initData: app.initData,
      email: 'anna@example.com',
      password: 'secret123',
    });
  });

  it('главная: срок, автопродление выключается переключателем', async () => {
    window.Telegram = { WebApp: fakeWebApp() };
    const state = makeState({
      autoRenew: { planId: 'pro', status: 'active', stars: 1670, nextChargeAt: inDays(12) },
    });
    const calls = mockApi((url) => {
      if (url === '/api/telegram/miniapp/session') return linkedSession(state);
      if (url === '/api/telegram/miniapp/auto-renew')
        return Response.json({ ...state, autoRenew: { ...state.autoRenew!, status: 'canceled' } });
      return undefined;
    });
    render(<TelegramAppPage />);

    expect(
      await screen.findByRole('progressbar', { name: 'Осталось дней: 12' }),
    ).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'Автопродление' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/Pro за 1\s670 ⭐ продлится/)).toBeInTheDocument();
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Автопродление' })).toHaveAttribute(
        'aria-checked',
        'false',
      ),
    );
    expect(calls.find((call) => call.url.endsWith('/auto-renew'))).toMatchObject({
      body: { enabled: false },
      auth: 'Bearer tok',
    });
    expect(await screen.findByText(/Автопродление выключено/)).toBeInTheDocument();
  });

  it('тарифы: пересчёт при смене и оплата подписки с автопродлением', async () => {
    const app = fakeWebApp({
      openInvoice: vi.fn(
        (_url: string, callback?: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void) =>
          callback?.('paid'),
      ),
    });
    window.Telegram = { WebApp: app };
    const state = makeState();
    const calls = mockApi((url) => {
      if (url === '/api/telegram/miniapp/session') return linkedSession(state);
      if (url === '/api/telegram/miniapp/invoice')
        return Response.json({
          invoiceId: 'stars_9',
          link: 'https://t.me/$inv',
          stars: 2460,
          recurring: true,
        });
      if (url === '/api/telegram/miniapp/invoice/stars_9') return Response.json({ status: 'paid' });
      if (url === '/api/telegram/miniapp/state') return Response.json(state);
      return undefined;
    });
    render(<TelegramAppPage />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Тарифы' }));
    const ultra = screen.getByRole('article', { name: /Ultra/ });
    expect(within(ultra).getByText('+6 дн. за остаток текущего тарифа')).toBeInTheDocument();
    const pro = screen.getByRole('article', { name: /Pro/ });
    // Pro $25 = 1 260 ⭐ по официальному курсу Telegram, рядом — сколько эти звёзды стоят у Telegram
    expect(within(pro).getByRole('button', { name: /Продлить за 1\s260 ⭐/ })).toBeInTheDocument();
    expect(within(pro).getByText('≈ $25.19')).toBeInTheDocument();
    expect(
      screen.getByText('Цены в звёздах — по официальному курсу Telegram: 1 000 ⭐ = $19.99.'),
    ).toBeInTheDocument();
    // Цена в звёздах как картой: пометки «дороже» нет
    expect(screen.queryByText(/В звёздах тариф дороже/)).not.toBeInTheDocument();
    expect(
      screen.getByText('На Fragment звёзды сейчас дешевле: ≈ $14.90 за 1 000 ⭐.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'С автопродлением' }));
    fireEvent.click(within(ultra).getByRole('button', { name: /Подписаться · 2\s460 ⭐ в месяц/ }));
    await waitFor(() =>
      expect(app.openInvoice).toHaveBeenCalledWith('https://t.me/$inv', expect.any(Function)),
    );
    expect(calls.find((call) => call.url === '/api/telegram/miniapp/invoice')?.body).toEqual({
      planId: 'ultra',
      recurring: true,
    });
    expect(
      await screen.findByText('Готово! Ultra включён, автопродление подключено.'),
    ).toBeInTheDocument();
  });

  it('платежи: чек и мгновенный возврат звёзд с причиной', async () => {
    const app = fakeWebApp();
    window.Telegram = { WebApp: app };
    const state = makeState();
    const calls = mockApi((url) => {
      if (url === '/api/telegram/miniapp/session') return linkedSession(state);
      if (url === '/api/telegram/miniapp/payments/stars%3Ach-1/refund') {
        return Response.json({
          outcome: 'refunded',
          ...state,
          subscription: { plan: 'free', status: 'active', renewsAt: null },
          payments: [
            payment({ status: 'refunded', refundOption: { kind: 'none', reason: 'refunded' } }),
          ],
        });
      }
      return undefined;
    });
    window.history.replaceState(null, '', '/tg?tab=payments');
    render(<TelegramAppPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Pro.*1\s670 ⭐/ }));
    const sheet = screen.getByRole('dialog', { name: 'Чек · Pro' });
    expect(within(sheet).getByText('Telegram Stars')).toBeInTheDocument();
    expect(app.BackButton!.show).toHaveBeenCalled();

    expect(
      within(sheet).getByText(/Вернуть можно до .*Первый же ответ модели закрывает возврат/),
    ).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Вернуть деньги' }));
    fireEvent.click(within(sheet).getByRole('button', { name: /Вернуть 1\s670 ⭐/ }));
    expect(within(sheet).getByText(/Выберите причину/)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Ошибся тарифом' }));
    fireEvent.change(within(sheet).getByLabelText('Комментарий (необязательно)'), {
      target: { value: 'Хотел Plus' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: /Вернуть 1\s670 ⭐/ }));

    expect(
      await screen.findByText(/Готово: 1\s670 ⭐ вернулись на баланс Telegram/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.find((call) => call.url.endsWith('/refund'))?.body).toEqual({
      reason: 'Ошибся тарифом',
      comment: 'Хотел Plus',
    });
    expect(screen.getByText('Возвращён')).toBeInTheDocument();
    expect(app.BackButton!.hide).toHaveBeenCalled();
  });

  it('платежи: после запроса к моделям вернуть оплату нельзя — кабинет объясняет почему', async () => {
    window.Telegram = { WebApp: fakeWebApp() };
    const state = makeState({
      payments: [payment({ refundOption: { kind: 'none', reason: 'used' } })],
    });
    mockApi((url) => (url === '/api/telegram/miniapp/session' ? linkedSession(state) : undefined));
    window.history.replaceState(null, '', '/tg?tab=payments');
    render(<TelegramAppPage />);

    expect(
      await screen.findByText(
        /Вернуть оплату можно в течение 24 часов после неё — если вы ещё не сделали ни одного запроса/,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Pro.*1\s670 ⭐/ }));
    const sheet = screen.getByRole('dialog', { name: 'Чек · Pro' });
    expect(
      within(sheet).getByText(/моделями уже пользовались, поэтому вернуть её нельзя/),
    ).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Вернуть деньги' })).not.toBeInTheDocument();
  });

  it('администратор: заявка на возврат одобряется из кабинета', async () => {
    window.Telegram = { WebApp: fakeWebApp() };
    const state = makeState({ user: { ...makeState().user, isAdmin: true }, pendingRefunds: 1 });
    let decided = false;
    const calls = mockApi((url) => {
      if (url === '/api/telegram/miniapp/session') return linkedSession(state);
      if (url === '/api/telegram/miniapp/admin/refunds') {
        return Response.json({
          refunds: decided
            ? []
            : [
                {
                  ...payment({
                    id: 'crypto:c-1',
                    method: 'crypto',
                    amount: 25,
                    currency: 'USD',
                    status: 'refund_requested',
                  }),
                  refund: {
                    requestedAt: new Date().toISOString(),
                    reason: 'Не пользуюсь',
                    comment: 'Уезжаю',
                  },
                  usedRequests: 0,
                  customer: { name: 'Иван', email: 'ivan@example.com', telegramUsername: null },
                },
              ],
        });
      }
      if (url === '/api/telegram/miniapp/admin/refunds/crypto%3Ac-1') {
        decided = true;
        return Response.json({ payment: payment({ status: 'refunded' }) });
      }
      if (url === '/api/telegram/miniapp/state')
        return Response.json({ ...state, pendingRefunds: 0 });
      return undefined;
    });
    window.history.replaceState(null, '', '/tg?tab=admin');
    render(<TelegramAppPage />);

    expect(await screen.findByText('Уезжаю')).toBeInTheDocument();
    expect(screen.getByText(/Иван · ivan@example\.com/)).toBeInTheDocument();
    expect(screen.getByText('запросов после оплаты не было')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть' }));
    expect(await screen.findByText('Новых заявок нет')).toBeInTheDocument();
    expect(calls.find((call) => call.url.endsWith('crypto%3Ac-1'))?.body).toEqual({
      approve: true,
      note: '',
    });
  });

  it('профиль: уведомления и вход на сайт одноразовой ссылкой', async () => {
    const app = fakeWebApp();
    window.Telegram = { WebApp: app };
    const state = makeState();
    const calls = mockApi((url) => {
      if (url === '/api/telegram/miniapp/session') return linkedSession(state);
      if (url === '/api/telegram/miniapp/prefs')
        return Response.json({ ...state, prefs: { reminders: false, receipts: true } });
      if (url === '/api/telegram/miniapp/site-login')
        return Response.json({ url: 'https://ketner.org/auth/telegram?t=abc&next=%2Fchat' });
      return undefined;
    });
    window.history.replaceState(null, '', '/tg?tab=profile');
    render(<TelegramAppPage />);

    fireEvent.click(await screen.findByRole('switch', { name: 'Напоминания о продлении' }));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Напоминания о продлении' })).toHaveAttribute(
        'aria-checked',
        'false',
      ),
    );
    expect(calls.find((call) => call.url.endsWith('/prefs'))?.body).toEqual({ reminders: false });

    fireEvent.click(screen.getByRole('button', { name: /Открыть Ketner AI/ }));
    await waitFor(() =>
      expect(app.openLink).toHaveBeenCalledWith(
        'https://ketner.org/auth/telegram?t=abc&next=%2Fchat',
      ),
    );
    expect(calls.find((call) => call.url.endsWith('/site-login'))?.body).toEqual({ next: '/chat' });
    expect(screen.getByRole('button', { name: /Отвязать Telegram/ })).toBeInTheDocument();
  });
});
