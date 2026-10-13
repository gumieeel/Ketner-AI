import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramAppPage } from '@/pages/telegram-app-page';
import type { TelegramWebApp } from '@/features/telegram/webapp';
import { resetPreferences } from './test-utils';

const STATE = {
  user: { id: 'u1', email: 'anna@example.com', name: 'Анна', plan: 'pro', isVip: false, telegramUsername: 'anna' },
  subscription: { plan: 'pro', status: 'active', renewsAt: new Date(Date.now() + 12 * 864e5).toISOString() },
  plans: [
    { id: 'plus', title: 'Plus', priceUsd: 9, stars: 600 },
    { id: 'pro', title: 'Pro', priceUsd: 25, stars: 1670 },
    { id: 'ultra', title: 'Ultra', priceUsd: 49, stars: 3270 },
  ],
  rate: { usdPerStar: 0.015, source: 'config', updatedAt: '2026-10-13T00:00:00Z' },
  history: [{ id: 'stars_1', method: 'stars', planId: 'pro', amount: '1670 ⭐', paidAt: '2026-10-01T10:00:00Z' }],
  siteUrl: 'https://ketner.org',
};

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
    ...overrides,
  };
}

describe('кабинет в Telegram (/tg)', () => {
  beforeEach(() => {
    resetPreferences();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.Telegram;
  });

  it('вне Telegram предлагает открыть бота', async () => {
    window.Telegram = { WebApp: fakeWebApp({ initData: '' }) };
    render(<TelegramAppPage />);
    expect(await screen.findByText('Кабинет открывается в Telegram')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Открыть бота/ })).toHaveAttribute('href', 'https://t.me/Robo_kassa_bot');
  });

  it('без привязки просит войти, после входа показывает подписку', async () => {
    const app = fakeWebApp();
    window.Telegram = { WebApp: app };
    const calls: Array<{ url: string; body?: string }> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, body: init.body as string });
      if (url === '/api/telegram/miniapp/session') {
        return Response.json({ linked: false, telegram: { firstName: 'Анна', username: 'anna' }, siteUrl: 'https://ketner.org' });
      }
      if (url === '/api/telegram/miniapp/link') return Response.json({ linked: true, token: 'tok', expiresAt: '', ...STATE });
      return Response.json({ error: { code: 'not_found', message: url } }, { status: 404 });
    });
    render(<TelegramAppPage />);

    expect(await screen.findByRole('heading', { name: 'Анна, привяжем аккаунт' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Подключить в настройках сайта/ }));
    expect(app.openLink).toHaveBeenCalledWith('https://ketner.org/settings#telegram');
    fireEvent.change(screen.getByLabelText('Почта'), { target: { value: 'anna@example.com' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти и привязать' }));

    expect(await screen.findByText('anna@example.com')).toBeInTheDocument();
    const link = calls.find((call) => call.url === '/api/telegram/miniapp/link')!;
    expect(JSON.parse(link.body!)).toEqual({ initData: app.initData, email: 'anna@example.com', password: 'secret123' });

  });

  it('привязанный аккаунт: срок подписки, цены в звёздах и оплата через openInvoice', async () => {
    const app = fakeWebApp({
      openInvoice: vi.fn((_url: string, callback?: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void) => callback?.('paid')),
    });
    window.Telegram = { WebApp: app };
    let paid = false;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url === '/api/telegram/miniapp/session') return Response.json({ linked: true, token: 'tok', expiresAt: '', ...STATE });
      if (url === '/api/telegram/miniapp/invoice' && init.method === 'POST') {
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
        return Response.json({ invoiceId: 'stars_9', link: 'https://t.me/$inv', stars: 1670 });
      }
      if (url === '/api/telegram/miniapp/invoice/stars_9') {
        paid = true;
        return Response.json({ status: 'paid' });
      }
      if (url === '/api/telegram/miniapp/state') {
        return Response.json({ ...STATE, subscription: { ...STATE.subscription, renewsAt: new Date(Date.now() + 42 * 864e5).toISOString() } });
      }
      return Response.json({ error: { code: 'not_found', message: url } }, { status: 404 });
    });
    render(<TelegramAppPage />);

    expect(await screen.findByText(/осталось 12 дн\./)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Осталось дней: 12' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Продлить за 1\s670 ⭐/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Перейти на Ultra · 3\s270 ⭐/ })).toBeInTheDocument();
    expect(screen.getByText('История оплат')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Продлить за 1\s670 ⭐/ }));
    await waitFor(() => expect(app.openInvoice).toHaveBeenCalledWith('https://t.me/$inv', expect.any(Function)));
    await waitFor(() => expect(screen.getByText('Готово! Тариф Pro включён.')).toBeInTheDocument());
    expect(paid).toBe(true);
    expect(await screen.findByText(/осталось 42 дн\./)).toBeInTheDocument();
  });
});
