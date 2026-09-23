import { getAuthToken } from '../auth/auth-store';
import { ApiError } from '../chat/api';
import type { Plan, PlanId, Subscription } from './types';

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
  });

  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function fetchPlans(): Promise<Plan[]> {
  const data = await request<{ plans: Plan[] }>('/plans');
  return data.plans;
}

export async function fetchSubscription(): Promise<Subscription> {
  const data = await request<{ subscription: Subscription }>('/billing/subscription');
  return data.subscription;
}

export async function checkout(
  planId: PlanId,
): Promise<{ subscription: Subscription; user: { plan: PlanId } }> {
  return request<{ subscription: Subscription; user: { plan: PlanId } }>('/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ planId }),
  });
}

export async function cancelSubscription(): Promise<{
  subscription: Subscription;
  user: { plan: PlanId };
}> {
  return request<{ subscription: Subscription; user: { plan: PlanId } }>('/billing/cancel', {
    method: 'POST',
  });
}
