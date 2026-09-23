import { create } from 'zustand';
import { storage } from '@/lib/storage';
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
    const { token } = get();
    if (!token) {
      set({ status: 'unauthenticated', user: null });
      return;
    }

    try {
      set({ status: 'loading' });
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
      const session = await apiLogin(payload);
      saveSession(session);
      set({ user: session.user, token: session.token, status: 'authenticated', error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка входа';
      set({ status: 'unauthenticated', error: message });
      throw error;
    }
  },

  signup: async (payload: SignupPayload) => {
    set({ status: 'loading', error: null });
    try {
      const session = await apiSignup(payload);
      saveSession(session);
      set({ user: session.user, token: session.token, status: 'authenticated', error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка регистрации';
      set({ status: 'unauthenticated', error: message });
      throw error;
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
