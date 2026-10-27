import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramAuthDialog } from '@/components/telegram/telegram-auth-dialog';
import { useAuth } from '@/features/auth/auth-store';
import { installFakeApi } from './fake-api';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';

const USER = {
  id: 'user-1',
  email: 'anna@example.com',
  name: 'Анна',
  plan: 'plus',
  createdAt: '2026-10-01T10:00:00.000Z',
};

type Handler = (url: string, init: RequestInit) => Response | undefined;

/** Фейковый API сайта плюс ручки привязки Telegram. */
function withTelegram(handler: Handler) {
  installFakeApi();
  const base = globalThis.fetch;
  const calls: Array<{ url: string; body?: unknown; auth?: string }> = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({
      url,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      auth: (init.headers as Record<string, string> | undefined)?.Authorization,
    });
    return handler(url, init) ?? base(input, init);
  });
  return calls;
}

describe('привязка Telegram на сайте (входа через Telegram нет)', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('окно привязки: ссылка на бота, ожидание и привязка после подтверждения', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let polls = 0;
    const calls = withTelegram((url) => {
      if (url === '/api/auth/telegram/start') {
        return Response.json({
          requestId: 'req-1',
          mode: 'link',
          botUrl: 'https://t.me/Robo_kassa_bot?start=auth_abc',
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        });
      }
      if (url === '/api/auth/telegram/poll/req-1') {
        polls += 1;
        return polls < 2
          ? Response.json({ status: 'pending' })
          : Response.json({ status: 'approved', mode: 'link', user: USER });
      }
      return undefined;
    });
    const onLinked = vi.fn();
    render(
      <TelegramAuthDialog token="session-token" onClose={() => undefined} onLinked={onLinked} />,
    );

    const open = await screen.findByRole('link', { name: /Открыть Telegram/ });
    expect(open).toHaveAttribute('href', 'https://t.me/Robo_kassa_bot?start=auth_abc');
    expect(calls.find((call) => call.url === '/api/auth/telegram/start')).toMatchObject({
      body: { mode: 'link' },
      auth: 'Bearer session-token',
    });
    expect(screen.getByRole('img', { name: /QR/ })).toBeInTheDocument();
    expect(screen.getByText('Ждём подтверждения в Telegram…')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(onLinked).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await waitFor(() => expect(onLinked).toHaveBeenCalledWith(USER));
    expect(screen.getByText('Telegram подключён')).toBeInTheDocument();
  });

  it('отказ в боте: окно объясняет и начинает заново', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let starts = 0;
    withTelegram((url) => {
      if (url === '/api/auth/telegram/start') {
        starts += 1;
        return Response.json({
          requestId: `req-${starts}`,
          mode: 'link',
          botUrl: 'https://t.me/Robo_kassa_bot?start=auth_x',
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        });
      }
      if (url.startsWith('/api/auth/telegram/poll/')) return Response.json({ status: 'declined' });
      return undefined;
    });
    render(<TelegramAuthDialog token="session-token" onClose={() => undefined} />);
    await screen.findByRole('link', { name: /Открыть Telegram/ });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    // Ответ опроса обрабатывается асинхронно: под нагрузкой одной секунды ожидания мало.
    expect(
      await screen.findByText('Подключение отклонено в Telegram.', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Начать заново' }));
    await screen.findByRole('link', { name: /Открыть Telegram/ });
    expect(starts).toBe(2);
  });

  it('входа через Telegram на сайте нет: ни кнопки, ни ссылки входа из кабинета', async () => {
    withTelegram(() => undefined);
    renderRoute('/login');
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Telegram/ })).not.toBeInTheDocument();
  });

  it('регистрации через Telegram нет: на странице регистрации кнопки нет', async () => {
    withTelegram(() => undefined);
    renderRoute('/signup');
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Telegram/ })).not.toBeInTheDocument();
  });

  it('старая ссылка входа из кабинета Telegram больше не входит', async () => {
    const calls = withTelegram(() => undefined);
    renderRoute('/auth/telegram?t=one-time&next=/pricing');
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(useAuth.getState().status).toBe('unauthenticated');
    expect(calls.some((call) => call.url.includes('/auth/telegram/magic'))).toBe(false);
  });

  it('настройки: свежий статус Telegram и привязка кодом из кабинета', async () => {
    useAuth.setState({
      user: USER as never,
      token: 'session-token',
      status: 'authenticated',
      error: null,
    });
    let linked = false;
    const calls = withTelegram((url) => {
      if (url === '/api/auth/me') {
        return Response.json({
          user: linked ? { ...USER, telegramChatId: 77, telegramUsername: 'anna_tg' } : USER,
        });
      }
      if (url === '/api/auth/telegram/claim') {
        linked = true;
        return Response.json({
          user: { ...USER, telegramChatId: 77, telegramUsername: 'anna_tg' },
        });
      }
      return undefined;
    });
    renderRoute('/settings');

    const section = await screen.findByRole('region', { name: 'Telegram' });
    expect(within(section).getByText('Не привязан')).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: /Ввести код/ }));
    fireEvent.change(within(section).getByLabelText('Код из кабинета в Telegram'), {
      target: { value: 'k7m2qx' },
    });
    fireEvent.click(within(section).getByRole('button', { name: 'Подключить' }));

    expect(
      await within(section).findByText(/Telegram подключён\. Кабинет кредитов/),
    ).toBeInTheDocument();
    expect(within(section).getByText('Подключён')).toBeInTheDocument();
    expect(within(section).getByText('@anna_tg')).toBeInTheDocument();
    expect(calls.find((call) => call.url === '/api/auth/telegram/claim')).toMatchObject({
      body: { code: 'K7M2QX' },
      auth: 'Bearer session-token',
    });
  });

  it('аккаунт из Telegram: вместо служебной почты — «Аккаунт Telegram», отвязки нет', async () => {
    const tgUser = {
      ...USER,
      email: 'tg-77@telegram.invalid',
      telegramChatId: 77,
      telegramUsername: 'anna_tg',
    };
    useAuth.setState({
      user: tgUser as never,
      token: 'session-token',
      status: 'authenticated',
      error: null,
    });
    withTelegram((url) => (url === '/api/auth/me' ? Response.json({ user: tgUser }) : undefined));
    renderRoute('/settings');

    const section = await screen.findByRole('region', { name: 'Telegram' });
    expect(within(section).getByText(/Аккаунт создан через Telegram/)).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Отвязать' })).not.toBeInTheDocument();
    expect(screen.queryByText(/telegram\.invalid/)).not.toBeInTheDocument();
  });
});
