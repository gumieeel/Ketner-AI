import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';

/**
 * /admin: гость — на вход с возвратом, вошедший не-администратор — «Страница не найдена»; ни тот,
 * ни другой не видят каркас админки и не шлют запросы к /api/admin.
 */
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubApi(me: Record<string, unknown> | null) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    calls.push(path);
    if (path === '/api/auth/me')
      return me ? json(200, { user: me }) : json(401, { error: { code: 'unauthorized' } });
    if (path === '/api/auth/get-session') return json(200, null);
    if (path.startsWith('/api/admin')) return json(200, {});
    return json(404, { error: { code: 'not_found' } });
  });
  return calls;
}

const USER = {
  id: 'u1',
  email: 'user@example.com',
  name: 'Анна',
  plan: 'free',
  isAdmin: false,
  createdAt: '2026-11-01T10:00:00.000Z',
};

function signIn(user: typeof USER) {
  useAuth.setState({ status: 'authenticated', token: 'jwt.token', user: user as never });
}

describe('доступ к /admin', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('гость уходит на вход с возвратом в /admin, запросов к /api/admin нет', async () => {
    const calls = stubApi(null);
    renderRoute('/admin/pricing');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Вход в Ketner AI' }),
    ).toBeVisible();
    // Возврат после входа — в /admin/pricing (ссылка «Забыли пароль?» несёт тот же redirect).
    const forgot = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href') ?? '')
      .find((href) => href.startsWith('/login/forgot'));
    expect(forgot).toContain(`redirect=${encodeURIComponent('/admin/pricing')}`);
    expect(calls.filter((path) => path.startsWith('/api/admin'))).toEqual([]);
  });

  it('вошедший не-администратор видит «Страница не найдена», без каркаса админки', async () => {
    const calls = stubApi(USER);
    signIn(USER);
    renderRoute('/admin');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Страница не найдена' }),
    ).toBeInTheDocument();
    expect(calls.filter((path) => path.startsWith('/api/admin'))).toEqual([]);
  });

  it('администратор открывает админку', async () => {
    const admin = { ...USER, isAdmin: true };
    const calls = stubApi(admin);
    signIn(admin);
    renderRoute('/admin');
    await waitFor(() => expect(calls.some((path) => path.startsWith('/api/admin'))).toBe(true));
    expect(screen.queryByRole('heading', { name: 'Страница не найдена' })).toBeNull();
  });
});
