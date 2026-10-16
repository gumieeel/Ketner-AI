import { create } from 'zustand';
import { storage } from '@/lib/storage';
import { authClient } from './auth-client';
import {
  fetchMe,
  login as apiLogin,
  logout as apiLogout,
  oauthLogin,
  signup as apiSignup,
} from './api';
import { ApiError } from '../chat/api';
import { useUpgradeModal } from '../billing/upgrade-modal-store';
import type { AuthSession, AuthStatus, LoginPayload, PlanId, SignupPayload, User } from './types';

interface AuthState {
  user: User | null;
  token: string | null;
  status: AuthStatus;
  error: string | null;
  login: (payload: LoginPayload) => Promise<void>;
  signup: (payload: SignupPayload) => Promise<void>;
  mockOAuth: (provider: 'google' | 'github') => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  setUser: (user: User | null) => void;
  /** Сессия, полученная не через форму: вход через Telegram или одноразовая ссылка из кабинета. */
  applySession: (session: AuthSession) => Promise<void>;
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
    // сохранённой копии доверять нельзя: иначе интерфейс показывает вошедшего пользователя (например,
    // Ultra), а все запросы уходят на сервер как гостевые (чат просит подписку, проекты просят войти).
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
    set({ status: 'loading', error: null });
    try {
      const session = await apiLogin(payload);
      const user = normalizeUser(session.user as unknown as Record<string, unknown>);
      saveSession({ user, token: session.token, expiresAt: session.expiresAt });
      useUpgradeModal.getState().close();
      set({ user, token: session.token, status: 'authenticated', error: null });

      // Синхронизируем сессию в Better Auth (куки). Сначала снимаем старую cookie-сессию: в браузере
      // мог остаться вход другого аккаунта (например, через Google), и сервер видел бы его вместо этого.
      try {
        await authClient.signOut();
      } catch {
        // Игнорируем
      }
      try {
        await authClient.signIn.email({
          email: payload.email,
          password: payload.password,
        });
      } catch {
        // Игнорируем
      }
    } catch (apiError) {
      const message =
        apiError instanceof Error ? apiError.message : 'Неверный адрес почты или пароль';
      set({ status: 'unauthenticated', error: message });
      throw apiError;
    }
  },

  signup: async (payload: SignupPayload) => {
    set({ status: 'loading', error: null });
    try {
      const session = await apiSignup(payload);
      const user = normalizeUser(session.user as unknown as Record<string, unknown>);
      saveSession({ user, token: session.token, expiresAt: session.expiresAt });
      useUpgradeModal.getState().close();
      set({ user, token: session.token, status: 'authenticated', error: null });

      // Синхронизируем сессию в Better Auth (куки). Сначала снимаем старую cookie-сессию: в браузере
      // мог остаться вход другого аккаунта (например, через Google), и сервер видел бы его вместо этого.
      try {
        await authClient.signOut();
      } catch {
        // Игнорируем
      }
      try {
        await authClient.signIn.email({
          email: payload.email,
          password: payload.password,
        });
      } catch {
        // Игнорируем
      }
    } catch (apiError) {
      const message = apiError instanceof Error ? apiError.message : 'Ошибка регистрации';
      set({ status: 'unauthenticated', error: message });
      throw apiError;
    }
  },

  mockOAuth: async (provider: 'google' | 'github') => {
    set({ status: 'loading', error: null });
    try {
      const session = await oauthLogin(provider);
      saveSession(session);
      useUpgradeModal.getState().close();
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
    useUpgradeModal.getState().close();
    set({ user: null, token: null, status: 'unauthenticated', error: null });
    if (token) {
      await apiLogout(token);
    }
  },

  applySession: async (session: AuthSession) => {
    // Снимаем cookie-сессию прежнего входа (Google/GitHub): иначе сервер мог бы видеть другой аккаунт.
    try {
      await authClient.signOut();
    } catch {
      // Игнорируем
    }
    const user = normalizeUser(session.user as unknown as Record<string, unknown>);
    saveSession({ user, token: session.token, expiresAt: session.expiresAt });
    useUpgradeModal.getState().close();
    set({ user, token: session.token, status: 'authenticated', error: null });
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
