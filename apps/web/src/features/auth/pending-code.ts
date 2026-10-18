import type { CodeFlow } from './types';

/**
 * Незавершённый вход, регистрация или восстановление пароля: данные отправлены, ждём код из письма.
 *
 * Хранится в sessionStorage (живёт в этой вкладке), чтобы страница ввода кода пережила
 * перезагрузку. Пароль сюда не пишется.
 */
export interface PendingCode {
  challengeId: string;
  /** Полная почта — только чтобы подставить её в форму при «Изменить почту». */
  email: string;
  maskedEmail: string;
  /** Когда можно запросить новый код (мс с эпохи). */
  resendAt: number;
}

const key = (flow: CodeFlow) => `ketner.pendingCode.${flow}`;

export function readPendingCode(flow: CodeFlow): PendingCode | null {
  try {
    const raw = window.sessionStorage.getItem(key(flow));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingCode>;
    if (typeof parsed.challengeId !== 'string' || typeof parsed.maskedEmail !== 'string') {
      return null;
    }
    return {
      challengeId: parsed.challengeId,
      email: typeof parsed.email === 'string' ? parsed.email : '',
      maskedEmail: parsed.maskedEmail,
      resendAt: typeof parsed.resendAt === 'number' ? parsed.resendAt : 0,
    };
  } catch {
    return null;
  }
}

export function savePendingCode(flow: CodeFlow, pending: PendingCode): void {
  try {
    window.sessionStorage.setItem(key(flow), JSON.stringify(pending));
  } catch {
    // Хранилище недоступно: страница кода работает до перезагрузки
  }
}

export function clearPendingCode(flow: CodeFlow): void {
  try {
    window.sessionStorage.removeItem(key(flow));
  } catch {
    // Игнорируем
  }
}

/**
 * Код сброса пароля принят, ждём новый пароль. Тоже в sessionStorage: токен одноразовый и живёт
 * 15 минут, а страница нового пароля должна пережить перезагрузку.
 */
export interface PendingReset {
  resetToken: string;
  /** Полная почта — для ссылки «Запросить код заново». */
  email: string;
  maskedEmail: string;
  /** До какого момента действует токен (мс с эпохи). */
  expiresAt: number;
}

const RESET_KEY = 'ketner.pendingReset';

export function readPendingReset(now = Date.now()): PendingReset | null {
  try {
    const raw = window.sessionStorage.getItem(RESET_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingReset>;
    if (
      typeof parsed.resetToken !== 'string' ||
      typeof parsed.maskedEmail !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      parsed.expiresAt <= now
    ) {
      return null;
    }
    return {
      resetToken: parsed.resetToken,
      email: typeof parsed.email === 'string' ? parsed.email : '',
      maskedEmail: parsed.maskedEmail,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export function savePendingReset(pending: PendingReset): void {
  try {
    window.sessionStorage.setItem(RESET_KEY, JSON.stringify(pending));
  } catch {
    // Хранилище недоступно: страница нового пароля работает до перезагрузки
  }
}

export function clearPendingReset(): void {
  try {
    window.sessionStorage.removeItem(RESET_KEY);
  } catch {
    // Игнорируем
  }
}
