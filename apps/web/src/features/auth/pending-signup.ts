/**
 * Незавершённая регистрация: форма отправлена, ждём код из письма.
 *
 * Хранится в sessionStorage (живёт в этой вкладке), чтобы страница ввода кода пережила
 * перезагрузку. Пароль сюда не пишется: его страница получает только в памяти (state навигации).
 */
export interface PendingSignup {
  signupId: string;
  email: string;
  /** Когда можно запросить новый код (мс с эпохи). */
  resendAt: number;
}

const KEY = 'ketner.pendingSignup';

export function readPendingSignup(): PendingSignup | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingSignup>;
    if (typeof parsed.signupId !== 'string' || typeof parsed.email !== 'string') return null;
    return {
      signupId: parsed.signupId,
      email: parsed.email,
      resendAt: typeof parsed.resendAt === 'number' ? parsed.resendAt : 0,
    };
  } catch {
    return null;
  }
}

export function savePendingSignup(pending: PendingSignup): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    // Хранилище недоступно: страница кода работает до перезагрузки
  }
}

export function clearPendingSignup(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Игнорируем
  }
}
