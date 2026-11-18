import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn();
vi.mock('@/features/auth/auth-client', () => ({
  authClient: {
    getSession: (...args: unknown[]) => getSession(...args),
    signIn: { email: vi.fn() },
    signOut: vi.fn(),
  },
}));

import { useAuth } from '@/features/auth/auth-store';
import { checkSessionInvalid, resetSessionCheckForTests } from '@/features/chat/api';
import { storage } from '@/lib/storage';

const ULTRA_USER = {
  id: 'u1',
  email: 'artem@example.com',
  name: 'Артем',
  plan: 'ultra',
  isVip: true,
  isAdmin: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function seedStoredSession(token: string): void {
  storage.set('session', token);
  storage.set('user', JSON.stringify(ULTRA_USER));
  useAuth.setState({ user: ULTRA_USER as never, token, status: 'authenticated', error: null });
}

function stubMe(status: number | 'network'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (status === 'network') throw new TypeError('Failed to fetch');
      return new Response(
        JSON.stringify(
          status === 200
            ? { user: ULTRA_USER }
            : { error: { code: 'unauthorized', message: 'Сессия не найдена' } },
        ),
        { status, headers: { 'Content-Type': 'application/json' } },
      );
    }),
  );
}

describe('restoreSession: устаревшая сохранённая сессия', () => {
  beforeEach(() => {
    getSession.mockReset();
    getSession.mockResolvedValue({ data: null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    storage.remove('session');
    storage.remove('user');
    useAuth.setState({ user: null, token: null, status: 'unauthenticated', error: null });
  });

  it('токен отклонён сервером (401): сессия сбрасывается, а не остаётся «Ultra» с гостевыми запросами', async () => {
    seedStoredSession('stale.jwt.token');
    stubMe(401);
    await useAuth.getState().restoreSession();
    expect(useAuth.getState().status).toBe('unauthenticated');
    expect(useAuth.getState().user).toBeNull();
    expect(useAuth.getState().token).toBeNull();
    expect(storage.get('session')).toBeNull();
  });

  it('токен-заглушка better-auth-session без cookie-сессии сбрасывается', async () => {
    seedStoredSession('better-auth-session');
    await useAuth.getState().restoreSession();
    expect(useAuth.getState().status).toBe('unauthenticated');
    expect(useAuth.getState().user).toBeNull();
  });

  it('нет сети: сохранённая сессия остаётся (офлайн не выкидывает из аккаунта)', async () => {
    seedStoredSession('valid.jwt.token');
    stubMe('network');
    getSession.mockRejectedValue(new TypeError('Failed to fetch'));
    await useAuth.getState().restoreSession();
    expect(useAuth.getState().status).toBe('authenticated');
    expect(useAuth.getState().user?.plan).toBe('ultra');
  });

  it('действующий токен: профиль обновляется с сервера', async () => {
    seedStoredSession('valid.jwt.token');
    stubMe(200);
    await useAuth.getState().restoreSession();
    expect(useAuth.getState().status).toBe('authenticated');
    expect(useAuth.getState().user?.plan).toBe('ultra');
  });

  it('есть cookie-сессия Better Auth: вход восстанавливается без Bearer-токена', async () => {
    seedStoredSession('stale.jwt.token');
    stubMe(401);
    getSession.mockResolvedValue({
      data: { user: ULTRA_USER, session: { token: 'cookie-session-token' } },
    });
    await useAuth.getState().restoreSession();
    expect(useAuth.getState().status).toBe('authenticated');
    expect(useAuth.getState().token).toBe('cookie-session-token');
  });
});

describe('ответ с X-Session-Invalid сбрасывает устаревшую сессию', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    storage.remove('session');
    storage.remove('user');
    useAuth.setState({ user: null, token: null, status: 'unauthenticated', error: null });
  });

  it('запрос чата с отклонённым токеном запускает пересверку, и сессия снимается', async () => {
    getSession.mockReset();
    getSession.mockResolvedValue({ data: null });
    seedStoredSession('stale.jwt.token');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/auth/me')) {
          return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'x' } }), {
            status: 401,
          });
        }
        return new Response(JSON.stringify({ conversations: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'X-Session-Invalid': '1' },
        });
      }),
    );
    const { fetchConversations } = await import('@/features/chat/api');
    await fetchConversations();
    await vi.waitFor(() => expect(useAuth.getState().status).toBe('unauthenticated'));
    expect(useAuth.getState().user).toBeNull();
  });
});

describe('проверка сессии не повторяется на каждый запрос', () => {
  beforeEach(() => {
    getSession.mockReset();
    resetSessionCheckForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    storage.remove('session');
    storage.remove('user');
    useAuth.setState({ user: null, token: null, status: 'unauthenticated', error: null });
  });

  it('одновременные вызовы делят одну проверку: один /api/auth/me и один get-session', async () => {
    seedStoredSession('stale.jwt.token');
    stubMe(401);
    let release: (value: { data: null }) => void = () => {};
    getSession.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const calls = Array.from({ length: 12 }, () => useAuth.getState().restoreSession());
    await vi.waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));
    release({ data: null });
    await Promise.all(calls);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(useAuth.getState().status).toBe('unauthenticated');
    // После завершения следующая проверка — снова настоящая.
    getSession.mockResolvedValue({ data: null });
    await useAuth.getState().restoreSession();
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it('ответы с X-Session-Invalid: одна проверка на пачку, повтор — не раньше чем через 30 с', async () => {
    seedStoredSession('stale.jwt.token');
    stubMe(200);
    getSession.mockResolvedValue({ data: null });
    const invalid = () => new Response('{}', { headers: { 'X-Session-Invalid': '1' } });
    for (let i = 0; i < 15; i += 1) checkSessionInvalid(invalid(), 1_000 + i);
    await vi.waitFor(() => expect(useAuth.getState().status).toBe('authenticated'));
    expect(fetch).toHaveBeenCalledTimes(1);
    checkSessionInvalid(invalid(), 20_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    checkSessionInvalid(invalid(), 31_001);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
