import { getAuthToken } from '../auth/auth-store';
import { ApiError, checkSessionInvalid } from '../chat/api';
import { API_BASE } from '@/lib/api-config';

export { ApiError };

/** Подключение Google Таблицы (этап F). Токены живут только на сервере. */
export interface GoogleSheetStatus {
  connected: boolean;
  status: 'connected' | 'reconnect_required' | 'sheet_missing' | 'disconnected' | null;
  email: string | null;
  spreadsheetUrl: string | null;
  lastErrorCode: string | null;
  connectedAt: string | null;
  /** Сколько заявок не записано (кнопка «дописать пропущенные»). */
  pending?: number;
}

/** Отметка у заявки: в таблице, записывается, не записано, ждёт подключения. */
export type LeadDeliveryState = 'written' | 'writing' | 'failed' | 'waiting';

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/integrations/google${path}`, {
      method: init.method ?? 'GET',
      headers,
      credentials: 'include',
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch {
    throw new ApiError('network_error', '', 0);
  }
  checkSessionInvalid(response);
  const body = (await response.json().catch(() => null)) as
    (T & { error?: { code?: string; message?: string } }) | null;
  if (!response.ok) {
    throw new ApiError(
      body?.error?.code ?? 'unknown_error',
      body?.error?.message ?? '',
      response.status,
    );
  }
  return body as T;
}

export const googleSheetsApi = {
  status: () => request<GoogleSheetStatus>(''),
  /** Адрес Google для согласия; после него человек вернётся на `returnTo`. */
  start: (returnTo: string) =>
    request<{ url: string }>('/start', { method: 'POST', body: { returnTo } }),
  confirm: (code: string, state: string) =>
    request<GoogleSheetStatus>('/confirm', { method: 'POST', body: { code, state } }),
  disconnect: () => request<GoogleSheetStatus>('/connection', { method: 'DELETE' }),
  newSheet: () => request<GoogleSheetStatus>('/new-sheet', { method: 'POST', body: {} }),
  /** Таблицу восстановили из корзины — проверить и подключить снова. */
  recheck: () => request<GoogleSheetStatus>('/recheck', { method: 'POST', body: {} }),
  backfill: () =>
    request<GoogleSheetStatus & { retried: number }>('/backfill', { method: 'POST', body: {} }),
  deliveries: async (solutionId: string) =>
    (
      await request<{ states: Record<string, LeadDeliveryState> }>(
        `/deliveries?solutionId=${encodeURIComponent(solutionId)}`,
      )
    ).states,
  retryLead: (leadId: string) =>
    request<{ result: string; state: LeadDeliveryState | null }>(
      `/leads/${encodeURIComponent(leadId)}/retry`,
      { method: 'POST', body: {} },
    ),
};

/** Фрагмент адреса после Google: код и state для подтверждения или ошибка. */
export function readGoogleReturn(
  hash: string,
): { code: string; state: string } | { error: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const error = params.get('google_error');
  if (error) return { error };
  const code = params.get('google_code');
  const state = params.get('google_state');
  return code && state ? { code, state } : null;
}

/** Убирает фрагмент из адреса: код не остаётся в истории браузера. */
export function clearGoogleReturn(): void {
  if (typeof window === 'undefined') return;
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, '', `${pathname}${search}`);
}
