import { ApiError } from '../chat/api';
import { API_BASE } from '@/lib/api-config';
import type { User } from '../auth/types';

export interface TelegramAuthStart {
  requestId: string;
  mode: 'link';
  botUrl: string;
  expiresAt: string;
}

export type TelegramAuthPoll =
  | { status: 'pending' | 'declined' | 'expired' | 'unlinked' }
  | { status: 'approved'; mode: 'link'; user: User };

/** Служебный адрес аккаунта, созданного через Telegram: показывать его не нужно. */
export function isTelegramOnlyEmail(email: string | null | undefined): boolean {
  return Boolean(email && email.endsWith('@telegram.invalid'));
}

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  // Вход через Google/GitHub живёт в cookie; токен-заглушку не отправляем.
  if (init.token && init.token !== 'better-auth-session')
    headers.Authorization = `Bearer ${init.token}`;
  const response = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers,
    credentials: 'include',
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

/** Привязка Telegram через бота: сайт создаёт запрос, человек подтверждает его в Telegram. */
export const telegramSiteAuth = {
  start: (token?: string | null) =>
    call<TelegramAuthStart>('/auth/telegram/start', { body: { mode: 'link' }, token }),
  poll: (requestId: string) =>
    call<TelegramAuthPoll>(`/auth/telegram/poll/${encodeURIComponent(requestId)}`),
  claim: (code: string, token?: string | null) =>
    call<{ user: User }>('/auth/telegram/claim', { body: { code }, token }),
  /** Свежий профиль (с полями Telegram) — и для входа по паролю, и для cookie-сессии Google/GitHub. */
  me: (token?: string | null) => call<{ user: User }>('/auth/me', { token }),
};
