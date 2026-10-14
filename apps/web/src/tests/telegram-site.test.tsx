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

/** Фейковый API сайта плюс ручки входа через Telegram. */
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

describe('вход и привязка Telegram на сайте', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('окно входа: ссылка на бота, ожидание и вход после подтверждения', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let polls = 0;
    withTelegram((url) => {
      if (url === '/api/auth/telegram/start') {
        return Response.json({
          requestId: 'req-1',
          mode: 'login',
          botUrl: 'https://t.me/Robo_kassa_bot?start=auth_abc',
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        });
      }
      if (url === '/api/auth/telegram/poll/req-1') {
        polls += 1;
        return polls < 2
          ? Response.json({ status: 'pending' })
          : Response.json({ status: 'approved', mode: 'login', token: 'tg-token', expiresAt: '', user: USER });
      }
      return undefined;
    });
    const onLogin = vi.fn();
    render(<TelegramAuthDialog mode="login" onClose={() => undefined} onLogin={onLogin} />);

    const open = await screen.findByRole('link', { name: /Открыть Telegram/ });
    expect(open).toHaveAttribute('href', 'https://t.me/Robo_kassa_bot?start=auth_abc');
    expect(screen.getByRole('img', { name: /QR/ })).toBeInTheDocument();
    expect(screen.getByText('Ждём подтверждения в Telegram…')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(onLogin).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(expect.objectContaining({ token: 'tg-token' })));
    expect(screen.getByText('Готово, входим…')).toBeInTheDocument();
  });

  it('отказ в боте: окно объясняет и начинает заново', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let starts = 0;
    withTelegram((url) => {
      if (url === '/api/auth/telegram/start') {
        starts += 1;
        return Response.json({
          requestId: `req-${starts}`,
          mode: 'login',
          botUrl: 'https://t.me/Robo_kassa_bot?start=auth_x',
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        });
      }
      if (url.startsWith('/api/auth/telegram/poll/')) return Response.json({ status: 'declined' });
      return undefined;
    });
    render(<TelegramAuthDialog mode="login" onClose={() => undefined} />);
    await screen.findByRole('link', { name: /Открыть Telegram/ });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(await screen.findByText('Вход отклонён в Telegram.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Начать заново' }));
    await screen.findByRole('link', { name: /Открыть Telegram/ });
    expect(starts).toBe(2);
  });

  it('страница входа предлагает «Войти через Telegram»', async () => {
    withTelegram((url) => {
      if (url === '/api/auth/telegram/start') {
        return Response.json({
          requestId: 'req-1',
          mode: 'login',
          botUrl: 'https://t.me/Robo_kassa_bot?start=auth_abc',
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        });
      }
      return undefined;
    });
    renderRoute('/login');
    fireEvent.click(await screen.findByRole('button', { name: 'Войти через Telegram' }));
    const dialog = await screen.findByRole('dialog', { name: 'Вход через Telegram' });
    expect(within(dialog).getByText(/бот создаст его/)).toBeInTheDocument();
  });

  it('одноразовая ссылка из кабинета входит и ведёт дальше; повтор — понятная ошибка', async () => {
    let used = false;
    const calls = withTelegram((url) => {
      if (url === '/api/auth/telegram/magic') {
        if (used) return Response.json({ error: { code: 'invalid_token', message: 'Ссылка для входа устарела.' } }, { status: 400 });
        used = true;
        return Response.json({ token: 'magic-session', expiresAt: '', user: USER });
      }
      return undefined;
    });
    renderRoute('/auth/telegram?t=one-time&next=/pricing');
    await waitFor(() => expect(useAuth.getState().token).toBe('magic-session'));
    expect(calls.find((call) => call.url === '/api/auth/telegram/magic')?.body).toEqual({ token: 'one-time' });
    expect(await screen.findByRole('heading', { level: 1, name: /Тариф|тариф|Plans|Цены|План/i })).toBeInTheDocument();

    resetAuth();
    renderRoute('/auth/telegram?t=one-time');
    expect(await screen.findByText('Ссылка для входа устарела.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Перейти ко входу' })).toHaveAttribute('href', '/login');
  });

  it('настройки: свежий статус Telegram и привязка кодом из кабинета', async () => {
    useAuth.setState({ user: USER as never, token: 'session-token', status: 'authenticated', error: null });
    let linked = false;
    const calls = withTelegram((url) => {
      if (url === '/api/auth/me') {
        return Response.json({ user: linked ? { ...USER, telegramChatId: 77, telegramUsername: 'anna_tg' } : USER });
      }
      if (url === '/api/auth/telegram/claim') {
        linked = true;
        return Response.json({ user: { ...USER, telegramChatId: 77, telegramUsername: 'anna_tg' } });
      }
      return undefined;
    });
    renderRoute('/settings');

    const section = await screen.findByRole('region', { name: 'Telegram' });
    expect(within(section).getByText('Не привязан')).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: /Ввести код/ }));
    fireEvent.change(within(section).getByLabelText('Код из кабинета в Telegram'), { target: { value: 'k7m2qx' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Подключить' }));

    expect(await within(section).findByText(/Telegram подключён\. Теперь можно входить/)).toBeInTheDocument();
    expect(within(section).getByText('Подключён')).toBeInTheDocument();
    expect(within(section).getByText('@anna_tg')).toBeInTheDocument();
    expect(calls.find((call) => call.url === '/api/auth/telegram/claim')).toMatchObject({
      body: { code: 'K7M2QX' },
      auth: 'Bearer session-token',
    });
  });

  it('аккаунт из Telegram: вместо служебной почты — «Аккаунт Telegram», отвязки нет', async () => {
    const tgUser = { ...USER, email: 'tg-77@telegram.invalid', telegramChatId: 77, telegramUsername: 'anna_tg' };
    useAuth.setState({ user: tgUser as never, token: 'session-token', status: 'authenticated', error: null });
    withTelegram((url) => (url === '/api/auth/me' ? Response.json({ user: tgUser }) : undefined));
    renderRoute('/settings');

    const section = await screen.findByRole('region', { name: 'Telegram' });
    expect(within(section).getByText(/Аккаунт создан через Telegram/)).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Отвязать' })).not.toBeInTheDocument();
    expect(screen.queryByText(/telegram\.invalid/)).not.toBeInTheDocument();
  });
});
