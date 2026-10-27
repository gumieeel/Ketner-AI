import { create } from 'zustand';
import { storage } from '@/lib/storage';
import { authClient } from './auth-client';
import {
  completePasswordReset as apiCompletePasswordReset,
  fetchMe,
  login as apiLogin,
  logout as apiLogout,
  oauthLogin,
  signup as apiSignup,
  verifyCode as apiVerifyCode,
} from './api';
import { ApiError } from '../chat/api';
import { useCreditsModal } from '../billing/credits-modal-store';
import type {
  AuthFlow,
  AuthSession,
  AuthStatus,
  CodeChallenge,
  CompletePasswordResetPayload,
  LoginPayload,
  PlanId,
  SignupPayload,
  User,
  VerifyCodePayload,
} from './types';

interface AuthState {
  user: User | null;
  token: string | null;
  status: AuthStatus;
  error: string | null;
  /** Почта и пароль; сессия появится после verifyCode с кодом из письма. */
  login: (payload: LoginPayload) => Promise<CodeChallenge>;
  /** Форма регистрации; аккаунт появится после verifyCode с кодом из письма. */
  signup: (payload: SignupPayload) => Promise<CodeChallenge>;
  /** Код из письма: завершает вход или регистрацию и открывает сессию. */
  verifyCode: (flow: AuthFlow, payload: VerifyCodePayload) => Promise<void>;
  /** Новый пароль после кода сброса: прежние сессии завершены, открывается новая. */
  completePasswordReset: (payload: CompletePasswordResetPayload) => Promise<void>;
  mockOAuth: (provider: 'google' | 'github') => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  setUser: (user: User | null) => void;
  clearError: () => void;
}

const SESSION_KEY = 'session';
const USER_KEY = 'user';

function readStoredSession(): { token: string | null; user: User | null } {
  const token = storage.get(SESSION_KEY);
  const rawUser = storage.get(USER_KEY);
  if (!token || !rawUser) {
    return { token: null, user: null };
  }
  try {
    const user = JSON.parse(rawUser) as User;
    return { token, user };
  } catch {
    return { token: null, user: null };
  }
}

function saveSession(session: AuthSession | null): void {
  if (!session) {
    storage.remove(SESSION_KEY);
    storage.remove(USER_KEY);
    return;
  }
  storage.set(SESSION_KEY, session.token);
  storage.set(USER_KEY, JSON.stringify(session.user));
}

function parsePlan(raw: unknown): PlanId {
  const VALID_PLANS: PlanId[] = [
    'free',
    'credits',
    'gpt-pro',
    'claude-pro',
    'gemini-pro',
    'ultra',
    'plus',
    'pro',
  ];
  if (typeof raw === 'string' && (VALID_PLANS as string[]).includes(raw)) {
    return raw as PlanId;
  }
  return 'free';
}

// Права определяет только сервер (ADMIN_EMAILS / VIP_EMAILS и записи в БД).
// Клиент не вычисляет их по email: это лишь отображение, доступ проверяется на API.
function parseIsAdmin(raw: unknown): boolean {
  return raw === true;
}

function parseIsVip(raw: unknown, plan?: PlanId): boolean {
  if (typeof raw === 'boolean') return raw;
  return plan === 'ultra';
}

export function normalizeUser(rawUser: Record<string, unknown>): User {
  const email = typeof rawUser.email === 'string' ? rawUser.email.trim().toLowerCase() : '';
  const plan = parsePlan(rawUser.plan);
  const isVip = parseIsVip(rawUser.isVip, plan);
  const isAdmin = parseIsAdmin(rawUser.isAdmin);
  const name =
    typeof rawUser.name === 'string' && rawUser.name.trim()
      ? rawUser.name.trim()
      : email.split('@')[0] || 'User';

  const telegramChatId =
    typeof rawUser.telegramChatId === 'number' || typeof rawUser.telegramChatId === 'string'
      ? rawUser.telegramChatId
      : undefined;
  const telegramUsername =
    typeof rawUser.telegramUsername === 'string' && rawUser.telegramUsername
      ? rawUser.telegramUsername
      : undefined;

  return {
    id: String(rawUser.id || 'user'),
    email,
    name,
    plan,
    isVip,
    isAdmin,
    createdAt: typeof rawUser.createdAt === 'string' ? rawUser.createdAt : new Date().toISOString(),
    ...(telegramChatId !== undefined ? { telegramChatId } : {}),
    ...(telegramUsername ? { telegramUsername } : {}),
  };
}

/** Сессия, выданная сервером после кода из письма или нового пароля: сохраняется и становится текущей. */
function openSession(session: AuthSession): Partial<AuthState> {
  const user = normalizeUser(session.user as unknown as Record<string, unknown>);
  saveSession({ user, token: session.token, expiresAt: session.expiresAt });
  useCreditsModal.getState().close();
  return { user, token: session.token, status: 'authenticated', error: null };
}

const initialSession = readStoredSession();

export const useAuth = create<AuthState>((set, get) => ({
  user: initialSession.user
    ? normalizeUser(initialSession.user as unknown as Record<string, unknown>)
    : null,
  token: initialSession.token,
  status: initialSession.token ? 'authenticated' : 'unauthenticated',
  error: null,

  clearError: () => set({ error: null }),

  restoreSession: async () => {
    const { token } = get();
    // Сервер ответил «нет»: токен отклонён или Better Auth-сессии (cookie) нет. В этом случае
    // сохранённой копии доверять нельзя: иначе интерфейс показывает вошедшего пользователя
    // (с остатком кредитов), а все запросы уходят на сервер как гостевые (чат и проекты просят войти).
    let rejectedByServer = false;
    let cookieSessionMissing = false;

    // 1. Если есть Bearer токен, запрашиваем актуальный профиль (/api/auth/me)
    if (token && token !== 'better-auth-session') {
      try {
        set({ status: 'loading' });
        const remoteUser = await fetchMe(token);
        const user = normalizeUser(remoteUser as unknown as Record<string, unknown>);
        saveSession({ user, token, expiresAt: '' });
        set({ user, status: 'authenticated', error: null });
        return;
      } catch (error) {
        // 401 — токен устарел или подпись не сошлась (ключ сменили при деплое); сетевая ошибка — нет.
        rejectedByServer = error instanceof ApiError && error.status === 401;
      }
    }

    // 2. Пробуем сессию Better Auth
    try {
      set({ status: 'loading' });
      const sessionResult = await authClient.getSession();
      if (sessionResult?.data?.user) {
        const bu = sessionResult.data.user as Record<string, unknown>;
        const user = normalizeUser(bu);
        const activeToken =
          sessionResult.data.session?.token || get().token || 'better-auth-session';
        saveSession({ user, token: activeToken, expiresAt: '' });
        set({ user, token: activeToken, status: 'authenticated', error: null });
        return;
      }
      cookieSessionMissing = true;
    } catch {
      // Сеть недоступна: ответа от сервера нет
    }

    // 3. Fallback на локально сохранённую сессию, только когда сервер её не отверг:
    //    например, нет сети. Токен-заглушка better-auth-session живёт только в cookie,
    //    поэтому без cookie она ничего не значит.
    const stored = readStoredSession();
    const storedIsCookieOnly = stored.token === 'better-auth-session';
    const usable = !rejectedByServer && !(storedIsCookieOnly && cookieSessionMissing);
    if (usable && stored.token && stored.user) {
      set({
        user: normalizeUser(stored.user as unknown as Record<string, unknown>),
        token: stored.token,
        status: 'authenticated',
        error: null,
      });
      return;
    }

    saveSession(null);
    set({ user: null, token: null, status: 'unauthenticated' });
  },

  login: async (payload: LoginPayload) => {
    set({ error: null });
    try {
      return await apiLogin(payload);
    } catch (apiError) {
      const message =
        apiError instanceof Error ? apiError.message : 'Неверный адрес почты или пароль';
      set({ error: message });
      throw apiError;
    }
  },

  signup: async (payload: SignupPayload) => {
    set({ error: null });
    try {
      return await apiSignup(payload);
    } catch (apiError) {
      const message = apiError instanceof Error ? apiError.message : 'Ошибка регистрации';
      set({ error: message });
      throw apiError;
    }
  },

  verifyCode: async (flow: AuthFlow, payload: VerifyCodePayload) => {
    set({ error: null });
    try {
      // Сервер в ответе ставит и cookie-сессию Better Auth этого аккаунта (вместо прежней, если была).
      set(openSession(await apiVerifyCode(flow, payload)));
    } catch (apiError) {
      const message = apiError instanceof Error ? apiError.message : 'Не удалось подтвердить код';
      set({ error: message });
      throw apiError;
    }
  },

  completePasswordReset: async (payload: CompletePasswordResetPayload) => {
    set({ error: null });
    try {
      set(openSession(await apiCompletePasswordReset(payload)));
    } catch (apiError) {
      const message = apiError instanceof Error ? apiError.message : 'Не удалось сменить пароль';
      set({ error: message });
      throw apiError;
    }
  },

  mockOAuth: async (provider: 'google' | 'github') => {
    set({ status: 'loading', error: null });
    try {
      const session = await oauthLogin(provider);
      saveSession(session);
      useCreditsModal.getState().close();
      set({ user: session.user, token: session.token, status: 'authenticated', error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка авторизации через соцсеть';
      set({ status: 'unauthenticated', error: message });
      throw error;
    }
  },

  logout: async () => {
    const { token } = get();
    try {
      await authClient.signOut();
    } catch {
      // Игнорируем сетевые ошибки при выходе
    }
    saveSession(null);
    useCreditsModal.getState().close();
    set({ user: null, token: null, status: 'unauthenticated', error: null });
    if (token) {
      await apiLogout(token);
    }
  },

  setUser: (user: User | null) => {
    set({ user });
    if (user) {
      storage.set(USER_KEY, JSON.stringify(user));
    }
  },
}));

/**
 * Читает токен авторизации для сетевых запросов.
 */
export function getAuthToken(): string | null {
  const { status, token } = useAuth.getState();
  if (status === 'unauthenticated') {
    return null;
  }
  return token ?? storage.get(SESSION_KEY);
}

export const useAuthStore = useAuth;
