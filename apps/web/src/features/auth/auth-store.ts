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
import { refreshAccountLimit } from '../billing/free-usage';
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

function parsePlan(raw: unknown, email?: string): PlanId {
  if (email?.toLowerCase() === 'artemsinyakov09@gmail.com') {
    return 'ultra';
  }
  const VALID_PLANS: PlanId[] = ['free', 'gpt-pro', 'claude-pro', 'gemini-pro', 'ultra', 'plus', 'pro'];
  if (typeof raw === 'string' && (VALID_PLANS as string[]).includes(raw)) {
    return raw as PlanId;
  }
  return 'free';
}

function parseIsAdmin(raw: unknown, email?: string): boolean {
  if (typeof raw === 'boolean') return raw;
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return (
    normalized === 'artemsinyakov09@gmail.com' ||
    normalized.startsWith('admin@') ||
    normalized.startsWith('admin.')
  );
}

function parseIsVip(raw: unknown, email?: string, plan?: PlanId): boolean {
  if (typeof raw === 'boolean') return raw;
  if (plan === 'ultra') return true;
  if (!email) return false;
  return email.trim().toLowerCase() === 'artemsinyakov09@gmail.com';
}

export function normalizeUser(rawUser: Record<string, unknown>): User {
  const email = typeof rawUser.email === 'string' ? rawUser.email.trim().toLowerCase() : '';
  const plan = parsePlan(rawUser.plan, email);
  const isVip = parseIsVip(rawUser.isVip, email, plan);
  const isAdmin = parseIsAdmin(rawUser.isAdmin, email);
  const name =
    typeof rawUser.name === 'string' && rawUser.name.trim()
      ? rawUser.name.trim()
      : email.split('@')[0] || 'User';

  return {
    id: String(rawUser.id || 'user'),
    email,
    name,
    plan,
    isVip,
    isAdmin,
    createdAt:
      typeof rawUser.createdAt === 'string' ? rawUser.createdAt : new Date().toISOString(),
  };
}

const initialSession = readStoredSession();

export const useAuth = create<AuthState>((set, get) => ({
  user: initialSession.user ? normalizeUser(initialSession.user as unknown as Record<string, unknown>) : null,
  token: initialSession.token,
  status: initialSession.token ? 'authenticated' : 'unauthenticated',
  error: null,

  clearError: () => set({ error: null }),

  restoreSession: async () => {
    const { token } = get();

    // 1. Если есть Bearer токен, запрашиваем актуальный профиль (/api/auth/me)
    if (token && token !== 'better-auth-session') {
      try {
        set({ status: 'loading' });
        const remoteUser = await fetchMe(token);
        const user = normalizeUser(remoteUser as unknown as Record<string, unknown>);
        saveSession({ user, token, expiresAt: '' });
        set({ user, status: 'authenticated', error: null });
        return;
      } catch {
        // Токен мог устареть, пробуем Better Auth сессию
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
    } catch {
      // Игнорируем
    }

    // 3. Fallback на локально сохранённую сессию
    const stored = readStoredSession();
    if (stored.token && stored.user) {
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
      refreshAccountLimit(user.id);
      useUpgradeModal.getState().close();
      set({ user, token: session.token, status: 'authenticated', error: null });

      // Синхронизируем сессию в Better Auth (куки)
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
      refreshAccountLimit(user.id);
      useUpgradeModal.getState().close();
      set({ user, token: session.token, status: 'authenticated', error: null });

      // Синхронизируем сессию в Better Auth (куки)
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
      refreshAccountLimit(session.user.id);
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
}));

/**
 * Читает токен авторизации для сетевых запросов.
 */
export function getAuthToken(): string | null {
  return useAuth.getState().token ?? storage.get(SESSION_KEY);
}
