/** Минимальное описание Telegram.WebApp — то, чем пользуется кабинет. */
export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: { id: number; first_name: string; username?: string; language_code?: string; photo_url?: string };
    start_param?: string;
  };
  colorScheme: 'light' | 'dark';
  version: string;
  ready(): void;
  expand(): void;
  isVersionAtLeast(version: string): boolean;
  openInvoice(url: string, callback?: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void): void;
  openLink(url: string, options?: { try_instant_view?: boolean }): void;
  openTelegramLink(url: string): void;
  showConfirm?(message: string, callback: (ok: boolean) => void): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  onEvent?(event: string, handler: () => void): void;
  offEvent?(event: string, handler: () => void): void;
  BackButton?: {
    isVisible: boolean;
    show(): void;
    hide(): void;
    onClick(handler: () => void): void;
    offClick(handler: () => void): void;
  };
  HapticFeedback?: {
    notificationOccurred(type: 'success' | 'error' | 'warning'): void;
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    selectionChanged?(): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const SCRIPT_URL = 'https://telegram.org/js/telegram-web-app.js';

/**
 * Подключает скрипт Telegram и отдаёт WebApp. Вне Telegram (обычный браузер) initData пустой —
 * тогда возвращается null, и страница предлагает открыть кабинет в боте.
 */
export function loadTelegramWebApp(timeoutMs = 5000): Promise<TelegramWebApp | null> {
  const ready = () => {
    const app = window.Telegram?.WebApp;
    return app && app.initData ? app : null;
  };
  if (window.Telegram?.WebApp) return Promise.resolve(ready());
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timer);
      resolve(ready());
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    document.head.appendChild(script);
  });
}

/** Безопасные вызовы: старые клиенты Telegram поддерживают не всё. */
export const haptic = {
  success: (app: TelegramWebApp | null) => tryCall(() => app?.HapticFeedback?.notificationOccurred('success')),
  error: (app: TelegramWebApp | null) => tryCall(() => app?.HapticFeedback?.notificationOccurred('error')),
  warning: (app: TelegramWebApp | null) => tryCall(() => app?.HapticFeedback?.notificationOccurred('warning')),
  tap: (app: TelegramWebApp | null) => tryCall(() => app?.HapticFeedback?.impactOccurred('light')),
  select: (app: TelegramWebApp | null) => tryCall(() => app?.HapticFeedback?.selectionChanged?.()),
};

function tryCall(fn: () => void): void {
  try {
    fn();
  } catch {
    // метод не поддерживается этой версией Telegram
  }
}

/** Цвет шапки и фона Telegram под тему кабинета (Telegram принимает только #RRGGBB). */
export function paintTelegramChrome(app: TelegramWebApp, color: string): void {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  tryCall(() => app.setHeaderColor?.(color));
  tryCall(() => app.setBackgroundColor?.(color));
  tryCall(() => app.setBottomBarColor?.(color));
}
