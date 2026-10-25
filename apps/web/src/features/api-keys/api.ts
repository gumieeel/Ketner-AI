import { getAuthToken } from '../auth/auth-store';
import { ApiError, checkSessionInvalid } from '../chat/api';
import { API_BASE } from '@/lib/api-config';

export { ApiError };

/** Ключ в списке: без секрета, только начало для опознания. */
export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

async function request<T>(path: string, init: RequestInit & { body?: string } = {}): Promise<T> {
  const headers: Record<string, string> =
    init.body !== undefined ? { 'Content-Type': 'application/json' } : {};
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
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

/** API-ключи для /v1: создаются и отзываются сессией сайта. */
export const apiKeysApi = {
  list: async () => (await request<{ keys: ApiKeyInfo[] }>('/keys')).keys,
  create: (name: string) =>
    request<{ key: ApiKeyInfo; secret: string }>('/keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  revoke: (id: string) =>
    request<{ ok: boolean }>(`/keys/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

/** Адрес OpenAI-совместимого API: тот же сайт, путь /v1. */
export function apiBaseUrl(): string {
  const configured = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_URL : undefined;
  const origin = configured
    ? String(configured).replace(/\/+$/, '')
    : typeof window !== 'undefined'
      ? window.location.origin
      : 'https://ketner.org';
  return `${origin}/v1`;
}
