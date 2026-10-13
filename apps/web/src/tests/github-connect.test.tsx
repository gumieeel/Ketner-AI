import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkWorkspaceModal } from '@/components/chat/link-workspace-modal';
import { useAuth } from '@/features/auth/auth-store';
import { useWorkspace } from '@/features/chat/workspace-store';
import { readGithubReturn, useGithub } from '@/features/github/github-store';
import { installFakeApi } from './fake-api';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';

const USER = {
  id: 'user-1',
  email: 'dev@example.com',
  name: 'Разработчик',
  plan: 'plus',
  createdAt: '2026-10-01T10:00:00.000Z',
};

function signIn(): void {
  useAuth.setState({ user: USER as never, token: 'session-token', status: 'authenticated', error: null });
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** Сервер с привязанным GitHub: прокси отдаёт приватный репозиторий с двумя ветками. */
function stubGithubServer(connected: boolean): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? init.body : undefined,
    });
    if (url === '/api/github/status') {
      return Response.json({
        available: true,
        connected,
        account: connected
          ? { login: 'octo', avatarUrl: null, scopes: ['repo'], connectedAt: '2026-10-01T10:00:00.000Z' }
          : null,
      });
    }
    if (url.startsWith('/api/github/connect-url')) {
      return Response.json({ url: 'https://github.com/login/oauth/authorize?client_id=test&state=s' });
    }
    if (url.startsWith('/api/github/api/user/repos')) {
      return Response.json([
        {
          full_name: 'octo/secret-app',
          name: 'secret-app',
          owner: { login: 'octo' },
          private: true,
          default_branch: 'develop',
          description: 'Закрытый проект',
          pushed_at: null,
        },
        {
          full_name: 'octo/site',
          name: 'site',
          owner: { login: 'octo' },
          private: false,
          default_branch: 'main',
          description: null,
          pushed_at: null,
        },
      ]);
    }
    if (url === '/api/github/api/repos/octo/secret-app/branches?per_page=100') {
      return Response.json([{ name: 'main' }, { name: 'develop' }]);
    }
    if (url === '/api/github/api/repos/octo/secret-app/git/trees/develop?recursive=1') {
      return Response.json({ tree: [{ path: 'package.json', type: 'blob', mode: '100644', size: 20 }] });
    }
    if (url === '/api/github/api/repos/octo/secret-app/contents/package.json?ref=develop') {
      return new Response('{"name":"secret"}');
    }
    return Response.json({ error: { code: 'not_found', message: url } }, { status: 404 });
  });
  return calls;
}

describe('привязка аккаунта GitHub', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    useGithub.getState().reset();
    useWorkspace.setState({ activeWorkspace: null });
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('разбирает ответ колбэка во фрагменте адреса', () => {
    expect(readGithubReturn('#github_code=abc&github_state=s.1')).toEqual({ code: 'abc', state: 's.1' });
    expect(readGithubReturn('#github_error=denied')).toEqual({ error: 'denied' });
    expect(readGithubReturn('#section')).toBeNull();
    expect(readGithubReturn('')).toBeNull();
  });

  it('после возврата с GitHub подтверждает подключение своей сессией и чистит адрес', async () => {
    signIn();
    const calls: Call[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({
        url: String(input),
        method: init.method ?? 'GET',
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body as string,
      });
      return Response.json({
        available: true,
        connected: true,
        account: { login: 'octo', avatarUrl: null, scopes: ['repo'], connectedAt: '2026-10-01T10:00:00.000Z' },
      });
    });
    window.history.replaceState(null, '', '/chat#github_code=abc&github_state=s1');
    window.sessionStorage.setItem('ketner.github.intent', 'link-repo');

    await useGithub.getState().completeFromLocation();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/github/confirm');
    expect(calls[0].method).toBe('POST');
    expect(JSON.parse(calls[0].body!)).toEqual({ code: 'abc', state: 's1' });
    expect(calls[0].headers.Authorization).toBe('Bearer session-token');
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/chat');
    const state = useGithub.getState();
    expect(state.status?.connected).toBe(true);
    expect(state.notice).toEqual({ kind: 'connected', login: 'octo' });
    expect(state.resumeIntent).toBe('link-repo');
    expect(window.sessionStorage.getItem('ketner.github.intent')).toBeNull();
  });

  it('без подключения окно привязки предлагает подключить GitHub, токен не спрашивает', async () => {
    signIn();
    const calls = stubGithubServer(false);
    render(
      <MemoryRouter>
        <LinkWorkspaceModal isOpen initialTab="git" onClose={() => undefined} />
      </MemoryRouter>,
    );

    const connect = await screen.findByRole('button', { name: 'Подключить GitHub' });
    expect(screen.queryByLabelText(/token/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Подключить репозиторий Ketner AI/)).not.toBeInTheDocument();

    fireEvent.click(connect);
    await waitFor(() =>
      expect(calls.some((call) => call.url.startsWith('/api/github/connect-url?returnTo='))).toBe(true),
    );
    await waitFor(() => expect(window.sessionStorage.getItem('ketner.github.intent')).toBe('link-repo'));
  });

  it('приватный репозиторий выбирается из списка, ветка — из настоящих веток, всё через прокси', async () => {
    signIn();
    const calls = stubGithubServer(true);
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <LinkWorkspaceModal isOpen initialTab="git" onClose={onClose} />
      </MemoryRouter>,
    );

    const repo = await screen.findByRole('radio', { name: /octo\/secret-app/ });
    expect(within(repo).getByText('Приватный')).toBeInTheDocument();
    expect(screen.getByText('GitHub: octo')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Поиск или ссылка/), { target: { value: 'secret' } });
    expect(screen.queryByRole('radio', { name: /octo\/site/ })).not.toBeInTheDocument();

    fireEvent.click(repo);
    expect(repo).toHaveAttribute('aria-checked', 'true');
    const branch = await screen.findByRole('combobox', { name: 'Ветка' });
    await waitFor(() => expect(branch).toHaveValue('develop'));

    fireEvent.click(screen.getByRole('button', { name: 'Привязать репозиторий' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const workspace = useWorkspace.getState().activeWorkspace;
    expect(workspace?.name).toBe('octo/secret-app');
    expect(workspace?.branch).toBe('develop');
    expect(workspace?.files.find((file) => file.path === 'package.json')?.content).toBe('{"name":"secret"}');
    expect(JSON.stringify(workspace)).not.toMatch(/token/i);
    // Ни одного прямого запроса в GitHub из браузера.
    expect(calls.every((call) => call.url.startsWith('/api/'))).toBe(true);
  });

  it('настройки показывают подключённый аккаунт и отключают его', async () => {
    signIn();
    installFakeApi({ github: { connected: true, login: 'octo' } });
    renderRoute('/settings');

    expect(await screen.findByRole('link', { name: '@octo' })).toHaveAttribute('href', 'https://github.com/octo');
    fireEvent.click(screen.getByRole('button', { name: 'Отключить' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Да, отключить' }));
    expect(await screen.findByText('Не подключён')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Подключить GitHub' })).toBeInTheDocument();
  });
});
