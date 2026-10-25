import { randomBytes } from 'node:crypto';

/**
 * Одноразовые коды привязки Telegram к аккаунту. Сайт выдаёт ссылку `t.me/<бот>?start=lnk_<код>`,
 * бот по коду узнаёт аккаунт. Код живёт 15 минут и срабатывает один раз: в отличие от id
 * пользователя в ссылке, его нельзя подобрать или переиспользовать.
 */
const TTL_MS = 15 * 60 * 1000;

export class TelegramLinkCodes {
  private codes = new Map<string, { userId: string; expiresAt: number }>();

  issue(userId: string, now = Date.now()): string {
    this.sweep(now);
    const code = randomBytes(12).toString('base64url');
    this.codes.set(code, { userId, expiresAt: now + TTL_MS });
    return code;
  }

  consume(code: string, now = Date.now()): string | null {
    const entry = this.codes.get(code);
    this.codes.delete(code);
    if (!entry || entry.expiresAt < now) return null;
    return entry.userId;
  }

  private sweep(now: number): void {
    for (const [code, entry] of this.codes) if (entry.expiresAt < now) this.codes.delete(code);
  }
}

export const telegramLinkCodes = new TelegramLinkCodes();
