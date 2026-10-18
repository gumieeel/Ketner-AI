import type { defaultBetterAuth } from './better-auth.js';
import { isTelegramAccountEmail } from '../telegram/auth-requests.js';
import type { SignupMethod } from '../services/signup-attribution.js';

type BetterAuthInstance = typeof defaultBetterAuth;

/**
 * Пароль в Better Auth всегда совпадает с паролем аккаунта сайта.
 *
 * Аккаунт сайта (user-store) и запись Better Auth связаны только почтой. Раньше регистрация в Better
 * Auth была открыта напрямую (`/api/auth/sign-up/email`), и чужой человек мог заранее (или позже)
 * завести там запись с почтой жертвы и своим паролем — cookie-сессия этой записи открывала аккаунт
 * жертвы. Теперь при каждой регистрации и входе по паролю запись Better Auth приводится к паролю
 * владельца, а сессии неподтверждённой записи (её мог создать посторонний) отзываются.
 */
export async function syncBetterAuthCredential(
  auth: BetterAuthInstance,
  email: string,
  password: string,
  name?: string,
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (isTelegramAccountEmail(normalized)) return;
  const ctx = await auth.$context;
  const found = await ctx.internalAdapter.findUserByEmail(normalized, { includeAccounts: true });
  if (!found) {
    await auth.api.signUpEmail({
      body: { email: normalized, password, name: name || normalized.split('@')[0] },
    });
    return;
  }
  const credential = found.accounts.find((account) => account.providerId === 'credential');
  if (
    credential?.password &&
    (await ctx.password.verify({ hash: credential.password, password }))
  ) {
    return;
  }
  const hash = await ctx.password.hash(password);
  if (credential) {
    await ctx.internalAdapter.updatePassword(found.user.id, hash);
  } else {
    await ctx.internalAdapter.linkAccount({
      userId: found.user.id,
      providerId: 'credential',
      accountId: found.user.id,
      password: hash,
    });
  }
  if (!found.user.emailVerified) {
    await ctx.internalAdapter.deleteUserSessions(found.user.id);
  }
}

/** Завершает все cookie-сессии Better Auth с этой почтой: пароль сброшен, прежние входы не действуют. */
export async function revokeBetterAuthSessions(
  auth: BetterAuthInstance,
  email: string,
): Promise<void> {
  const ctx = await auth.$context;
  const found = await ctx.internalAdapter.findUserByEmail(email.trim().toLowerCase());
  if (found) await ctx.internalAdapter.deleteUserSessions(found.user.id);
}

/** Насколько могут расходиться даты создания записи Better Auth и аккаунта сайта при регистрации. */
const CREATED_TOGETHER_MS = 2 * 60 * 1000;

/**
 * Можно ли по cookie-сессии Better Auth войти в аккаунт сайта с той же почтой.
 *
 * - Служебные адреса Telegram-аккаунтов (`tg-…@telegram.invalid`) входят только через Telegram.
 * - Почта, подтверждённая провайдером (Google, GitHub), — да.
 * - Неподтверждённая (вход по паролю) — только если запись Better Auth создана вместе с аккаунтом
 *   сайта при регистрации. Запись, заведённая отдельно (до или после), могла принадлежать другому
 *   человеку: такой сессии не верим, владелец продолжает входить по своему токену.
 */
export function betterAuthSessionMayOpen(
  sessionUser: { email: string; emailVerified?: boolean | null; createdAt?: Date | string | null },
  stored: { email: string; createdAt: string } | null,
): boolean {
  if (isTelegramAccountEmail(sessionUser.email)) return false;
  if (sessionUser.emailVerified === true) return true;
  if (!stored || !sessionUser.createdAt) return false;
  const sessionCreated = new Date(sessionUser.createdAt).getTime();
  const storedCreated = Date.parse(stored.createdAt);
  if (!Number.isFinite(sessionCreated) || !Number.isFinite(storedCreated)) return false;
  return Math.abs(sessionCreated - storedCreated) <= CREATED_TOGETHER_MS;
}

/** Способ входа по самой ранней привязке Better Auth: credential — почта, остальное — провайдер. */
export function signupMethodFromProvider(providerId: string | null | undefined): SignupMethod {
  if (providerId === 'credential') return 'email';
  if (providerId === 'google' || providerId === 'github') return providerId;
  return 'unknown';
}

/**
 * Каким способом создан аккаунт, который заводится по cookie-сессии Better Auth.
 * Ошибка чтения не мешает входу: способ просто остаётся неизвестным.
 */
export async function betterAuthSignupMethod(
  auth: BetterAuthInstance,
  email: string,
): Promise<SignupMethod> {
  try {
    const ctx = await auth.$context;
    const found = await ctx.internalAdapter.findUserByEmail(email.trim().toLowerCase(), {
      includeAccounts: true,
    });
    const accounts = [...(found?.accounts ?? [])].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const social = accounts.find((account) => account.providerId !== 'credential');
    return signupMethodFromProvider(social?.providerId ?? accounts[0]?.providerId);
  } catch {
    return 'unknown';
  }
}
