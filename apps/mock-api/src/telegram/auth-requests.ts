import { randomBytes, randomInt } from 'node:crypto';

/**
 * Вход и привязка через Telegram без команд и паролей.
 *
 * 1. Сайт создаёт запрос (`login` — войти, `link` — привязать Telegram к текущему аккаунту) и
 *    получает ссылку на бота `?start=auth_<код>`. Человек нажимает «Подтвердить» в боте, сайт
 *    раз в пару секунд опрашивает статус по секретному id и получает сессию.
 * 2. Мини-приложение выдаёт короткий код, который вводят в настройках сайта (если аккаунт
 *    открыт на другом устройстве).
 * 3. Одноразовые ссылки входа на сайт из мини-приложения.
 *
 * Всё живёт минуты и хранится в памяти: после перезапуска достаточно начать заново.
 */

export type AuthMode = 'login' | 'link';
export type AuthStatus = 'pending' | 'approved' | 'declined' | 'expired';

export interface AuthRequest {
  id: string;
  code: string;
  mode: AuthMode;
  /** Для привязки — аккаунт на сайте, к которому привязываем Telegram. */
  siteUserId?: string;
  /** Описание устройства, с которого начат вход (браузер и система) — показывается в боте. */
  device: string;
  createdAt: number;
  expiresAt: number;
  status: AuthStatus;
  /** Аккаунт, в который вошли (после подтверждения). */
  userId?: string;
  /** Сессия отдаётся сайту один раз. */
  delivered?: boolean;
}

const REQUEST_TTL_MS = 5 * 60 * 1000;
const CLAIM_TTL_MS = 10 * 60 * 1000;
const MAGIC_TTL_MS = 2 * 60 * 1000;
/** Без похожих символов (0/O, 1/I): код вводят руками. */
const CLAIM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class TelegramAuthRequests {
  private byId = new Map<string, AuthRequest>();
  private byCode = new Map<string, string>();
  private claims = new Map<string, { telegramUserId: number; username?: string; expiresAt: number }>();
  private magic = new Map<string, { userId: string; expiresAt: number }>();

  create(mode: AuthMode, device: string, siteUserId?: string, now = Date.now()): AuthRequest {
    this.sweep(now);
    const request: AuthRequest = {
      id: randomBytes(18).toString('base64url'),
      code: randomBytes(12).toString('base64url'),
      mode,
      siteUserId,
      device: device.slice(0, 80) || 'браузер',
      createdAt: now,
      expiresAt: now + REQUEST_TTL_MS,
      status: 'pending',
    };
    this.byId.set(request.id, request);
    this.byCode.set(request.code, request.id);
    return { ...request };
  }

  /** Запрос по коду из ссылки на бота (только ожидающий и не истёкший). */
  byStartCode(code: string, now = Date.now()): AuthRequest | null {
    const id = this.byCode.get(code);
    const request = id ? this.byId.get(id) : undefined;
    if (!request) return null;
    if (request.expiresAt < now && request.status === 'pending') request.status = 'expired';
    return { ...request };
  }

  resolve(code: string, decision: { approve: true; userId: string } | { approve: false }, now = Date.now()): AuthRequest | null {
    const id = this.byCode.get(code);
    const request = id ? this.byId.get(id) : undefined;
    if (!request || request.status !== 'pending' || request.expiresAt < now) return null;
    if (decision.approve) {
      request.status = 'approved';
      request.userId = decision.userId;
    } else {
      request.status = 'declined';
    }
    return { ...request };
  }

  /** Опрос с сайта. Сессию по одобренному запросу можно забрать один раз. */
  poll(id: string, now = Date.now()): { status: AuthStatus; userId?: string; mode?: AuthMode } {
    const request = this.byId.get(id);
    if (!request) return { status: 'expired' };
    if (request.status === 'pending' && request.expiresAt < now) request.status = 'expired';
    if (request.status === 'approved') {
      if (request.delivered) return { status: 'expired' };
      request.delivered = true;
      return { status: 'approved', userId: request.userId, mode: request.mode };
    }
    return { status: request.status, mode: request.mode };
  }

  /** Код из мини-приложения для ввода на сайте. */
  issueClaimCode(telegramUserId: number, username: string | undefined, now = Date.now()): { code: string; expiresAt: number } {
    this.sweep(now);
    for (const [code, claim] of this.claims) if (claim.telegramUserId === telegramUserId) this.claims.delete(code);
    let code = '';
    do {
      code = Array.from({ length: 6 }, () => CLAIM_ALPHABET[randomInt(CLAIM_ALPHABET.length)]).join('');
    } while (this.claims.has(code));
    const expiresAt = now + CLAIM_TTL_MS;
    this.claims.set(code, { telegramUserId, username, expiresAt });
    return { code, expiresAt };
  }

  consumeClaimCode(raw: string, now = Date.now()): { telegramUserId: number; username?: string } | null {
    const code = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const claim = this.claims.get(code);
    this.claims.delete(code);
    if (!claim || claim.expiresAt < now) return null;
    return { telegramUserId: claim.telegramUserId, username: claim.username };
  }

  /** Одноразовая ссылка входа на сайт (действует 2 минуты). */
  issueMagic(userId: string, now = Date.now()): string {
    this.sweep(now);
    const token = randomBytes(24).toString('base64url');
    this.magic.set(token, { userId, expiresAt: now + MAGIC_TTL_MS });
    return token;
  }

  consumeMagic(token: string, now = Date.now()): string | null {
    const entry = this.magic.get(token);
    this.magic.delete(token);
    if (!entry || entry.expiresAt < now) return null;
    return entry.userId;
  }

  private sweep(now: number): void {
    for (const [id, request] of this.byId) {
      if (request.expiresAt + REQUEST_TTL_MS < now) {
        this.byId.delete(id);
        this.byCode.delete(request.code);
      }
    }
    for (const [code, claim] of this.claims) if (claim.expiresAt < now) this.claims.delete(code);
    for (const [token, entry] of this.magic) if (entry.expiresAt < now) this.magic.delete(token);
  }
}

export const telegramAuthRequests = new TelegramAuthRequests();

/** Короткое описание устройства по User-Agent: «Chrome · Windows». */
export function describeDevice(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /YaBrowser/.test(ua)
      ? 'Яндекс Браузер'
      : /OPR\//.test(ua)
        ? 'Opera'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'браузер';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} · ${os}` : browser;
}

/** Аккаунт, созданный через Telegram, получает служебный адрес: по нему не войти паролем. */
export const TELEGRAM_EMAIL_DOMAIN = 'telegram.invalid';

export function telegramAccountEmail(telegramUserId: number): string {
  return `tg-${telegramUserId}@${TELEGRAM_EMAIL_DOMAIN}`;
}

export function isTelegramAccountEmail(email: string | undefined | null): boolean {
  return Boolean(email && email.endsWith(`@${TELEGRAM_EMAIL_DOMAIN}`));
}
