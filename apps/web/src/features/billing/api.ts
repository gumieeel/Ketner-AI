import { getAuthToken } from '../auth/auth-store';
import { ApiError } from '../chat/api';
import { API_BASE } from '@/lib/api-config';
import type { PlanId, Subscription } from './types';

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
  const token = getAuthToken();
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (init?.headers) {
    Object.assign(headers, init.headers);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function fetchSubscription(): Promise<Subscription> {
  const data = await request<{ subscription: Subscription }>('/billing/subscription');
  return data.subscription;
}

/** Отмена подписки прежней системы: новых подписок нет, но действующую можно отключить. */
export async function cancelSubscription(): Promise<{
  subscription: Subscription;
  user: { plan: PlanId };
}> {
  return request<{ subscription: Subscription; user: { plan: PlanId } }>('/billing/cancel', {
    method: 'POST',
  });
}
