import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Привязка Telegram к аккаунту по коду из письма.
 *
 * Человек в кабинете Telegram вводит почту аккаунта, сайт присылает на неё 6-значный код, человек
 * вводит код в Telegram — и этот Telegram привязывается к аккаунту. Код доказывает владение почтой,
 * поэтому пароль не нужен. На один Telegram действует один код: новый запрос заменяет прежний.
 * Хранится только хеш кода; после 5 неверных попыток код сгорает. Всё живёт минуты и хранится в
 * памяти: после перезапуска достаточно запросить код заново.
 */

export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
/** Повторно прислать код можно не раньше чем через минуту. */
export const EMAIL_CODE_RESEND_MS = 60 * 1000;

interface PendingCode {
  hash: Buffer;
  userId: string;
  expiresAt: number;
  issuedAt: number;
  attempts: number;
}

export type EmailCodeCheck =
  | { ok: true; userId: string }
  | { ok: false; reason: 'missing' | 'expired' | 'invalid' | 'attempts' };

const hashCode = (code: string): Buffer => createHash('sha256').update(code).digest();

export class EmailLinkCodes {
  private byTelegram = new Map<number, PendingCode>();

  /** Через сколько миллисекунд можно прислать новый код этому Telegram (0 — уже можно). */
  resendIn(telegramUserId: number, now = Date.now()): number {
    const pending = this.byTelegram.get(telegramUserId);
    if (!pending || pending.expiresAt <= now) return 0;
    return Math.max(0, pending.issuedAt + EMAIL_CODE_RESEND_MS - now);
  }

  issue(
    telegramUserId: number,
    userId: string,
    now = Date.now(),
  ): { code: string; expiresAt: number } {
    this.sweep(now);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = now + EMAIL_CODE_TTL_MS;
    this.byTelegram.set(telegramUserId, {
      hash: hashCode(code),
      userId,
      expiresAt,
      issuedAt: now,
      attempts: 0,
    });
    return { code, expiresAt };
  }

  /** Проверка кода. Верный код сгорает сразу, неверный — после исчерпания попыток. */
  check(telegramUserId: number, raw: string, now = Date.now()): EmailCodeCheck {
    const pending = this.byTelegram.get(telegramUserId);
    if (!pending) return { ok: false, reason: 'missing' };
    if (pending.expiresAt <= now) {
      this.byTelegram.delete(telegramUserId);
      return { ok: false, reason: 'expired' };
    }
    const code = raw.replace(/\D/g, '');
    if (code.length === 6 && timingSafeEqual(hashCode(code), pending.hash)) {
      this.byTelegram.delete(telegramUserId);
      return { ok: true, userId: pending.userId };
    }
    pending.attempts += 1;
    if (pending.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
      this.byTelegram.delete(telegramUserId);
      return { ok: false, reason: 'attempts' };
    }
    return { ok: false, reason: 'invalid' };
  }

  private sweep(now: number): void {
    for (const [id, pending] of this.byTelegram) {
      if (pending.expiresAt <= now) this.byTelegram.delete(id);
    }
  }
}
