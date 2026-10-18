import type { AuthFlow } from './types';

/**
 * Незавершённый вход или регистрация: данные отправлены, ждём код из письма.
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

const key = (flow: AuthFlow) => `ketner.pendingCode.${flow}`;

export function readPendingCode(flow: AuthFlow): PendingCode | null {
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

export function savePendingCode(flow: AuthFlow, pending: PendingCode): void {
  try {
    window.sessionStorage.setItem(key(flow), JSON.stringify(pending));
  } catch {
    // Хранилище недоступно: страница кода работает до перезагрузки
  }
}

export function clearPendingCode(flow: AuthFlow): void {
  try {
    window.sessionStorage.removeItem(key(flow));
  } catch {
    // Игнорируем
  }
}
