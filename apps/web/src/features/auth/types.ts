export type PlanId = 'free' | 'gpt-pro' | 'claude-pro' | 'gemini-pro' | 'ultra' | 'plus' | 'pro';

export interface User {
  id: string;
  email: string;
  name: string;
  plan: PlanId;
  createdAt: string;
  isVip?: boolean;
  isAdmin?: boolean;
  telegramChatId?: number | string;
  telegramUsername?: string;
}

export interface AuthSession {
  user: User;
  token: string;
  expiresAt: string;
}

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

export interface LoginPayload {
  email: string;
  password: string;
}

export interface SignupPayload {
  email: string;
  password: string;
  name?: string;
}

/** Ответ формы регистрации: аккаунт ещё не создан, на почту отправлен код. */
export interface SignupStart {
  status: 'verification_required';
  signupId: string;
  email: string;
  codeExpiresAt: string;
  resendAfterSec: number;
}

export interface VerifySignupPayload {
  signupId: string;
  code: string;
}
