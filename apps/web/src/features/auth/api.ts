import { ApiError } from '../chat/api';
import type { AuthSession, LoginPayload, SignupPayload, User } from './types';

const API_BASE = '/api';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function toApiError(response: Response): Promise<ApiError> {
  const fallback = `Запрос завершился со статусом ${response.status}`;
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return new ApiError(
      body.error?.code ?? 'unknown_error',
      body.error?.message ?? fallback,
      response.status,
    );
  } catch {
    return new ApiError('unknown_error', fallback, response.status);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...JSON_HEADERS, ...init?.headers },
  });

  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function login(payload: LoginPayload): Promise<AuthSession> {
  return request<AuthSession>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function signup(payload: SignupPayload): Promise<AuthSession> {
  return request<AuthSession>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchMe(token: string): Promise<User> {
  const body = await request<{ user: User }>('/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return body.user;
}

export async function logout(token?: string): Promise<void> {
  try {
    await request<void>('/auth/logout', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
  } catch {
    // Ошибки логаута на сервере не должны блокировать сброс локальной сессии
  }
}

export async function oauthLogin(provider: 'google' | 'github'): Promise<AuthSession> {
  return request<AuthSession>(`/auth/oauth/${provider}`);
}
