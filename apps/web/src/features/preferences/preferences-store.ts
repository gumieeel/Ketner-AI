import { create } from 'zustand';
import { storage } from '@/lib/storage';

export type Theme = 'light' | 'dark';
export type Language = 'ru' | 'en';

interface PreferencesState {
  theme: Theme;
  language: Language;
  sidebarOpen: boolean;
  /** Список чатов закреплён слева на широких экранах; по умолчанию свёрнут. */
  sidebarDocked: boolean;
  /** Выбранная модель чата: переживает перезагрузку страницы. */
  chatModelId: string;
  /**
   * Режим Max: модели Pro и Ultra размышляют на уровне xhigh вместо medium, запрос стоит дороже.
   * Хранится как выбор пользователя; для гостя не действует (см. reasoningModeFor).
   */
  maxMode: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setLanguage: (language: Language) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  toggleSidebarDocked: () => void;
  setChatModelId: (modelId: string) => void;
  setMaxMode: (on: boolean) => void;
}

export const DEFAULT_THEME: Theme = 'dark';
export const DEFAULT_LANGUAGE: Language = 'ru';
/** Модель по умолчанию: совпадает с defaultModelId из GET /api/meta. */
export const DEFAULT_MODEL_ID = 'auto';

/** Цвет системной панели браузера: совпадает с токеном --canvas каждой темы. */
export const THEME_COLOR: Record<Theme, string> = {
  dark: '#1a1c1b',
  light: '#eceee9',
};

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', THEME_COLOR[theme]);
  }
}

function readStoredTheme(): Theme {
  const stored = storage.get('theme');
  return stored === 'light' || stored === 'dark' ? stored : DEFAULT_THEME;
}

function readStoredLanguage(): Language {
  const stored = storage.get('language');
  return stored === 'ru' || stored === 'en' ? stored : DEFAULT_LANGUAGE;
}

function readStoredModelId(): string {
  return storage.get('model') ?? DEFAULT_MODEL_ID;
}

function readStoredSidebarDocked(): boolean {
  return storage.get('sidebarDocked') === '1';
}

function readStoredMaxMode(): boolean {
  return storage.get('maxMode') === '1';
}

/**
 * Пользовательские настройки интерфейса.
 *
 * Язык и тема живут в localStorage, чтобы пережить перезагрузку страницы.
 * Язык интерфейса не зависит от будущих данных аккаунта: после подключения
 * реальной авторизации эти значения станут стартовыми для профиля.
 */
export const usePreferences = create<PreferencesState>((set, get) => ({
  theme: readStoredTheme(),
  language: readStoredLanguage(),
  sidebarOpen: false,
  sidebarDocked: readStoredSidebarDocked(),
  chatModelId: readStoredModelId(),
  maxMode: readStoredMaxMode(),

  setTheme: (theme) => {
    storage.set('theme', theme);
    applyTheme(theme);
    set({ theme });
  },

  toggleTheme: () => {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
  },

  setLanguage: (language) => {
    storage.set('language', language);
    set({ language });
  },

  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  toggleSidebarDocked: () => {
    const sidebarDocked = !get().sidebarDocked;
    storage.set('sidebarDocked', sidebarDocked ? '1' : '0');
    set({ sidebarDocked });
  },

  setChatModelId: (chatModelId) => {
    storage.set('model', chatModelId);
    set({ chatModelId });
  },

  setMaxMode: (maxMode) => {
    storage.set('maxMode', maxMode ? '1' : '0');
    set({ maxMode });
  },
}));
