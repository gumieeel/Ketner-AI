import { ApiError } from '../chat/api';
import { API_BASE } from '@/lib/api-config';
import type {
  AuthFlow,
  AuthSession,
  CodeChallenge,
  CodeFlow,
  CompletePasswordResetPayload,
  LoginPayload,
  PasswordResetGrant,
  SignupPayload,
  User,
  VerifyCodePayload,
} from './types';

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
    credentials: 'include',
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

/** Первый шаг входа: почта и пароль. Сервер отправляет код на почту, сессии ещё нет. */
export async function login(payload: LoginPayload): Promise<CodeChallenge> {
  return request<CodeChallenge>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Первый шаг регистрации: сервер отправляет код на почту, аккаунт ещё не создан. */
export async function signup(payload: SignupPayload): Promise<CodeChallenge> {
  return request<CodeChallenge>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Второй шаг: код из письма. Регистрация создаёт аккаунт, вход — выдаёт сессию; cookie-сессию
 * Better Auth сервер ставит сам.
 */
export async function verifyCode(flow: AuthFlow, payload: VerifyCodePayload): Promise<AuthSession> {
  return request<AuthSession>(`/auth/${flow}/verify`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function resendCode(flow: CodeFlow, challengeId: string): Promise<CodeChallenge> {
  return request<CodeChallenge>(`/auth/${flow}/resend`, {
    method: 'POST',
    body: JSON.stringify({ challengeId }),
  });
}

/**
 * «Забыли пароль?»: код сброса уходит на почту, если такой аккаунт есть. Ответ одинаковый в обоих
 * случаях — по нему нельзя узнать, зарегистрирована ли почта.
 */
export async function requestPasswordReset(email: string): Promise<CodeChallenge> {
  return request<CodeChallenge>('/auth/password-reset', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

/** Код сброса из письма → одноразовый токен для нового пароля. */
export async function verifyPasswordResetCode(
  payload: VerifyCodePayload,
): Promise<PasswordResetGrant> {
  return request<PasswordResetGrant>('/auth/password-reset/verify', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Новый пароль: сервер завершает прежние сессии и открывает новую (cookie Better Auth — тоже). */
export async function completePasswordReset(
  payload: CompletePasswordResetPayload,
): Promise<AuthSession> {
  return request<AuthSession>('/auth/password-reset/complete', {
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

export async function unlinkTelegram(token?: string): Promise<User> {
  const body = await request<{ user: User }>('/auth/telegram-unlink', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return body.user;
}
