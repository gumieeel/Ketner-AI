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

/** Вход и регистрация по почте — оба подтверждаются кодом из письма. */
export type AuthFlow = 'signup' | 'login';

/** Всё, что подтверждается кодом из письма: вход, регистрация и восстановление пароля. */
export type CodeFlow = AuthFlow | 'password-reset';

/** Ответ формы входа, регистрации или «Забыли пароль?»: сессии ещё нет, на почту отправлен код. */
export interface CodeChallenge {
  status: 'verification_required';
  challengeId: string;
  /** Почта для показа: `i***v@example.com`. */
  maskedEmail: string;
  codeExpiresAt: string;
  resendAfterSec: number;
}

export interface VerifyCodePayload {
  challengeId: string;
  code: string;
}

/** Код сброса пароля принят: с этим токеном можно задать новый пароль (одноразовый, 15 минут). */
export interface PasswordResetGrant {
  status: 'code_verified';
  resetToken: string;
  maskedEmail: string;
  expiresAt: string;
}

export interface CompletePasswordResetPayload {
  resetToken: string;
  password: string;
}
