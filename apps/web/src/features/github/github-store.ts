import { create } from 'zustand';
import { ApiError, githubApi, type GithubStatus } from './api';

/** Что человек делал, когда ушёл подключать GitHub: после возврата продолжаем с того же места. */
export type GithubIntent = 'link-repo' | 'code-import';

/** Результат возврата с GitHub — показывается коротким уведомлением. */
export type GithubNotice =
  | { kind: 'connected'; login: string }
  | { kind: 'denied' }
  | { kind: 'failed'; message?: string };

const INTENT_KEY = 'ketner.github.intent';

/** Разбирает фрагмент адреса, который оставляет колбэк подключения. */
export function readGithubReturn(
  hash: string,
): { code: string; state: string } | { error: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const error = params.get('github_error');
  if (error) return { error };
  const code = params.get('github_code');
  const state = params.get('github_state');
  return code && state ? { code, state } : null;
}

function clearHash(): void {
  if (typeof window === 'undefined') return;
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, '', `${pathname}${search}`);
}

function readIntent(): GithubIntent | null {
  try {
    const value = sessionStorage.getItem(INTENT_KEY);
    return value === 'link-repo' || value === 'code-import' ? value : null;
  } catch {
    return null;
  }
}

function writeIntent(intent: GithubIntent | null): void {
  try {
    if (intent) sessionStorage.setItem(INTENT_KEY, intent);
    else sessionStorage.removeItem(INTENT_KEY);
  } catch {
    // без sessionStorage просто не продолжим действие автоматически
  }
}

interface GithubStore {
  status: GithubStatus | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  notice: GithubNotice | null;
  /** Действие, к которому вернуться после подключения (открыть выбор репозитория и т.п.). */
  resumeIntent: GithubIntent | null;

  load: (force?: boolean) => Promise<GithubStatus | null>;
  /** Уводит на GitHub; после подтверждения человек вернётся на текущую страницу. */
  connect: (intent?: GithubIntent) => Promise<void>;
  disconnect: () => Promise<void>;
  /** Завершает подключение, если адрес содержит ответ колбэка. */
  completeFromLocation: () => Promise<void>;
  consumeIntent: (intent: GithubIntent) => boolean;
  dismissNotice: () => void;
  reset: () => void;
}

let inflight: Promise<GithubStatus | null> | null = null;

export const useGithub = create<GithubStore>((set, get) => ({
  status: null,
  loading: false,
  busy: false,
  error: null,
  notice: null,
  resumeIntent: null,

  async load(force = false) {
    if (!force && get().status) return get().status;
    if (inflight) return inflight;
    set({ loading: true, error: null });
    inflight = githubApi
      .status()
      .then((status) => {
        set({ status, loading: false });
        return status;
      })
      .catch((error: unknown) => {
        set({ loading: false, error: error instanceof ApiError ? error.message : 'Не удалось проверить подключение GitHub' });
        return null;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  },

  async connect(intent) {
    set({ busy: true, error: null });
    try {
      const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
      const { url } = await githubApi.connectUrl(returnTo);
      writeIntent(intent ?? null);
      window.location.assign(url);
    } catch (error) {
      set({ busy: false, error: error instanceof ApiError ? error.message : 'Не удалось начать подключение GitHub' });
    }
  },

  async disconnect() {
    set({ busy: true, error: null });
    try {
      const status = await githubApi.disconnect();
      set({ status, busy: false });
    } catch (error) {
      set({ busy: false, error: error instanceof ApiError ? error.message : 'Не удалось отключить GitHub' });
    }
  },

  async completeFromLocation() {
    if (typeof window === 'undefined') return;
    const result = readGithubReturn(window.location.hash);
    if (!result) return;
    clearHash();
    const intent = readIntent();
    writeIntent(null);
    if ('error' in result) {
      set({ notice: result.error === 'denied' ? { kind: 'denied' } : { kind: 'failed' } });
      return;
    }
    set({ busy: true, error: null });
    try {
      const status = await githubApi.confirm(result.code, result.state);
      set({
        status,
        busy: false,
        notice: { kind: 'connected', login: status.account?.login ?? '' },
        resumeIntent: intent,
      });
    } catch (error) {
      set({
        busy: false,
        notice: { kind: 'failed', message: error instanceof ApiError ? error.message : undefined },
      });
    }
  },

  consumeIntent(intent) {
    if (get().resumeIntent !== intent) return false;
    set({ resumeIntent: null });
    return true;
  },

  dismissNotice: () => set({ notice: null }),

  reset: () => set({ status: null, error: null, notice: null, resumeIntent: null, busy: false }),
}));

/** Подключён ли GitHub прямо сейчас (по последнему известному статусу). */
export const selectGithubConnected = (state: GithubStore): boolean => Boolean(state.status?.connected);
