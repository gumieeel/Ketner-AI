import { getAuthToken } from '../auth/auth-store';
import { ApiError, checkSessionInvalid } from '../chat/api';
import { API_BASE } from '@/lib/api-config';

export { ApiError };

/** Привязанный аккаунт GitHub. Сам токен живёт только на сервере. */
export interface GithubAccount {
  login: string;
  avatarUrl: string | null;
  scopes: string[];
  connectedAt: string;
}

export interface GithubStatus {
  /** Подключение GitHub настроено на сервере. */
  available: boolean;
  connected: boolean;
  account: GithubAccount | null;
}

export interface GithubRepo {
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  pushedAt: string | null;
}

/** Ошибка подключения (не подключён, доступ отозван и т.п.), а не ответ самого GitHub. */
export class GithubConnectionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'GithubConnectionError';
    this.code = code;
  }
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers = { ...extra };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function request<T>(path: string, init: RequestInit & { body?: string } = {}): Promise<T> {
  const headers = authHeaders(
    init.body !== undefined ? { 'Content-Type': 'application/json' } : {},
  );
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
  checkSessionInvalid(response);
  if (!response.ok) {
    let code = 'unknown_error';
    let message = `Запрос завершился со статусом ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // тело не JSON — оставляем общее сообщение
    }
    throw new ApiError(code, message, response.status);
  }
  return (await response.json()) as T;
}

/** Ошибки самого прокси приходят в формате `{ error: { code, message } }`, ответы GitHub — нет. */
const CONNECTION_CODES = new Set([
  'github_not_connected',
  'github_reauth_required',
  'github_call_forbidden',
  'github_unavailable',
  'rate_limited',
  'unauthorized',
]);

/**
 * Запрос к GitHub REST от имени привязанного аккаунта: через `/api/github/api`, токен подставляет
 * сервер. `path` — как у api.github.com (`/repos/owner/repo/...`). Возвращает ответ GitHub как есть;
 * проблемы с самим подключением бросаются как GithubConnectionError.
 */
export async function githubFetch(
  path: string,
  init: { method?: string; body?: unknown; accept?: string } = {},
): Promise<Response> {
  const headers = authHeaders({ Accept: init.accept ?? 'application/vnd.github+json' });
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_BASE}/github/api${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: 'include',
  });
  checkSessionInvalid(response);
  if (!response.ok) {
    try {
      const body = (await response.clone().json()) as {
        error?: { code?: string; message?: string };
      };
      const code = body.error?.code;
      if (code && CONNECTION_CODES.has(code)) {
        throw new GithubConnectionError(code, body.error?.message ?? 'GitHub недоступен');
      }
    } catch (error) {
      if (error instanceof GithubConnectionError) throw error;
      // тело не JSON — это ответ GitHub, разбирает вызывающий код
    }
  }
  return response;
}

interface RawRepo {
  full_name: string;
  name: string;
  owner: { login: string };
  private: boolean;
  default_branch: string;
  description: string | null;
  pushed_at: string | null;
}

export const githubApi = {
  status: () => request<GithubStatus>('/github/status'),
  connectUrl: (returnTo: string) =>
    request<{ url: string }>(`/github/connect-url?returnTo=${encodeURIComponent(returnTo)}`),
  confirm: (code: string, state: string) =>
    request<GithubStatus>('/github/confirm', {
      method: 'POST',
      body: JSON.stringify({ code, state }),
    }),
  disconnect: () => request<GithubStatus>('/github/connection', { method: 'DELETE' }),

  /** Репозитории аккаунта, включая приватные и репозитории организаций; свежие сверху. */
  async repos(): Promise<GithubRepo[]> {
    const all: GithubRepo[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const response = await githubFetch(
        `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
      );
      if (!response.ok) throw new Error(`GitHub не отдал список репозиториев (${response.status})`);
      const batch = (await response.json()) as RawRepo[];
      for (const repo of batch) {
        all.push({
          fullName: repo.full_name,
          owner: repo.owner.login,
          name: repo.name,
          private: repo.private,
          defaultBranch: repo.default_branch,
          description: repo.description,
          pushedAt: repo.pushed_at,
        });
      }
      if (batch.length < 100) break;
    }
    return all;
  },

  async defaultBranch(owner: string, repo: string): Promise<string> {
    const response = await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    );
    if (!response.ok) throw new Error(`GitHub не отдал репозиторий (${response.status})`);
    return ((await response.json()) as { default_branch?: string }).default_branch ?? '';
  },

  async branches(owner: string, repo: string): Promise<string[]> {
    const response = await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`,
    );
    if (!response.ok) throw new Error(`GitHub не отдал список веток (${response.status})`);
    return ((await response.json()) as Array<{ name: string }>).map((branch) => branch.name);
  },
};
