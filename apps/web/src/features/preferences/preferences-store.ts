import { create } from 'zustand';
import { storage } from '@/lib/storage';

export type Theme = 'light' | 'dark';
export type Language = 'ru' | 'en';

interface PreferencesState {
  theme: Theme;
  language: Language;
  sidebarOpen: boolean;
  /** Выбранная модель чата: переживает перезагрузку страницы. */
  chatModelId: string;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setLanguage: (language: Language) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setChatModelId: (modelId: string) => void;
}

export const DEFAULT_THEME: Theme = 'dark';
export const DEFAULT_LANGUAGE: Language = 'ru';
/** Модель по умолчанию: совпадает с defaultModelId из GET /api/meta. */
export const DEFAULT_MODEL_ID = 'auto';

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', theme === 'dark' ? '#212121' : '#ffffff');
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
  chatModelId: readStoredModelId(),

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

  setChatModelId: (chatModelId) => {
    storage.set('model', chatModelId);
    set({ chatModelId });
  },
}));
