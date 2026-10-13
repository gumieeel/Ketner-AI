import { ApiError } from '../chat/api';
import { API_BASE } from '@/lib/api-config';
import type { PlanId } from '../billing/types';

export { ApiError };

export interface MiniAppPlan {
  id: PlanId;
  title: string;
  priceUsd: number;
  stars: number;
}

export interface MiniAppState {
  user: { id: string; email: string; name: string; plan: PlanId; isVip: boolean; telegramUsername: string | null };
  subscription: { plan: PlanId; status: 'active' | 'trialing' | 'past_due' | 'canceled'; renewsAt: string | null };
  plans: MiniAppPlan[];
  rate: { usdPerStar: number; source: 'fragment' | 'config'; updatedAt: string };
  history: Array<{ id: string; method: 'stars' | 'crypto'; planId: PlanId; amount: string; paidAt: string }>;
  siteUrl: string;
}

export type MiniAppSession =
  | ({ linked: true; token: string; expiresAt: string } & MiniAppState)
  | { linked: false; telegram: { firstName: string; username: string | null }; siteUrl: string };

async function call<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const response = await fetch(`${API_BASE}/telegram/miniapp${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    let code = 'unknown_error';
    let message = `Запрос завершился со статусом ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // не JSON
    }
    throw new ApiError(code, message, response.status);
  }
  return (await response.json()) as T;
}

/** API кабинета в Telegram: вход по initData, затем обычный токен сессии сайта. */
export const miniAppApi = {
  session: (initData: string) => call<MiniAppSession>('/session', { body: { initData } }),
  link: (initData: string, email: string, password: string) =>
    call<MiniAppSession>('/link', { body: { initData, email, password } }),
  state: (token: string) => call<MiniAppState>('/state', { token }),
  invoice: (token: string, planId: PlanId) =>
    call<{ invoiceId: string; link: string; stars: number }>('/invoice', { token, body: { planId } }),
  invoiceStatus: (token: string, invoiceId: string) =>
    call<{ status: 'pending' | 'paid' }>(`/invoice/${encodeURIComponent(invoiceId)}`, { token }),
  unlink: (token: string) => call<{ ok: boolean }>('/unlink', { token, body: {} }),
};
