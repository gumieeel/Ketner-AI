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
import type { AuthSession, AuthStatus, LoginPayload, SignupPayload, User } from './types';

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

const initialSession = readStoredSession();

export const useAuth = create<AuthState>((set, get) => ({
  user: initialSession.user,
  token: initialSession.token,
  status: initialSession.token ? 'authenticated' : 'unauthenticated',
  error: null,

  clearError: () => set({ error: null }),

  restoreSession: async () => {
    // 1. Сначала пробуем восстановить сессию через Better Auth клиент
    try {
      set({ status: 'loading' });
      const sessionResult = await authClient.getSession();
      if (sessionResult?.data?.user) {
        const bu = sessionResult.data.user;
        const user: User = {
          id: bu.id,
          email: bu.email,
          name: bu.name,
          plan:
            (bu as Record<string, unknown>).plan === 'pro'
              ? 'pro'
              : (bu as Record<string, unknown>).plan === 'plus'
                ? 'plus'
                : 'free',
          createdAt: bu.createdAt ? new Date(bu.createdAt).toISOString() : new Date().toISOString(),
        };
        const token = sessionResult.data.session?.token || get().token || 'better-auth-session';
        saveSession({ user, token, expiresAt: '' });
        set({ user, token, status: 'authenticated', error: null });
        return;
      }
    } catch {
      // Игнорируем и пробуем fallback по токену
    }

    const { token } = get();
    if (!token) {
      set({ status: 'unauthenticated', user: null });
      return;
    }

    try {
      const user = await fetchMe(token);
      saveSession({ user, token, expiresAt: '' });
      set({ user, status: 'authenticated', error: null });
    } catch {
      saveSession(null);
      set({ user: null, token: null, status: 'unauthenticated' });
    }
  },

  login: async (payload: LoginPayload) => {
    set({ status: 'loading', error: null });
    try {
      // Пробуем нативный вход через Better Auth
      const res = await authClient.signIn.email({
        email: payload.email,
        password: payload.password,
      });

      if (res?.data?.user) {
        const bu = res.data.user;
        const user: User = {
          id: bu.id,
          email: bu.email,
          name: bu.name,
          plan:
            (bu as Record<string, unknown>).plan === 'pro'
              ? 'pro'
              : (bu as Record<string, unknown>).plan === 'plus'
                ? 'plus'
                : 'free',
          createdAt: bu.createdAt ? new Date(bu.createdAt).toISOString() : new Date().toISOString(),
        };
        const token =
          ((res.data as Record<string, unknown>).token as string) || 'better-auth-session';
        saveSession({ user, token, expiresAt: '' });
        set({ user, token, status: 'authenticated', error: null });
        return;
      }

      if (res?.error) {
        throw new Error(res.error.message || 'Неверный адрес почты или пароль');
      }
    } catch (betterAuthError) {
      // Fallback на REST API (для fake-api в тестах и обратной совместимости)
      try {
        const session = await apiLogin(payload);
        saveSession(session);
        set({ user: session.user, token: session.token, status: 'authenticated', error: null });
        return;
      } catch {
        const message =
          betterAuthError instanceof Error
            ? betterAuthError.message
            : 'Неверный адрес почты или пароль';
        set({ status: 'unauthenticated', error: message });
        throw betterAuthError;
      }
    }
  },

  signup: async (payload: SignupPayload) => {
    set({ status: 'loading', error: null });
    try {
      // Пробуем нативную регистрацию через Better Auth
      const res = await authClient.signUp.email({
        email: payload.email,
        password: payload.password,
        name: payload.name || payload.email.split('@')[0],
      });

      if (res?.data?.user) {
        const bu = res.data.user;
        const user: User = {
          id: bu.id,
          email: bu.email,
          name: bu.name,
          plan:
            (bu as Record<string, unknown>).plan === 'pro'
              ? 'pro'
              : (bu as Record<string, unknown>).plan === 'plus'
                ? 'plus'
                : 'free',
          createdAt: bu.createdAt ? new Date(bu.createdAt).toISOString() : new Date().toISOString(),
        };
        const token =
          ((res.data as Record<string, unknown>).token as string) || 'better-auth-session';
        saveSession({ user, token, expiresAt: '' });
        set({ user, token, status: 'authenticated', error: null });
        return;
      }

      if (res?.error) {
        throw new Error(res.error.message || 'Ошибка регистрации');
      }
    } catch (betterAuthError) {
      // Fallback на REST API (для fake-api в тестах и обратной совместимости)
      try {
        const session = await apiSignup(payload);
        saveSession(session);
        set({ user: session.user, token: session.token, status: 'authenticated', error: null });
        return;
      } catch {
        const message =
          betterAuthError instanceof Error ? betterAuthError.message : 'Ошибка регистрации';
        set({ status: 'unauthenticated', error: message });
        throw betterAuthError;
      }
    }
  },

  mockOAuth: async (provider: 'google' | 'github') => {
    set({ status: 'loading', error: null });
    try {
      const session = await oauthLogin(provider);
      saveSession(session);
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
    set({ user: null, token: null, status: 'unauthenticated', error: null });
    if (token) {
      await apiLogout(token);
    }
  },
}));

/**
 * Читает токен авторизации для сетевых запросов.
 */
export function getAuthToken(): string | null {
  return useAuth.getState().token ?? storage.get(SESSION_KEY);
}
