/**
 * Лимиты анализов (docs/discovery-models.md, раздел 3).
 *
 * Бесплатный анализ: 1 в сутки на аккаунт или гостевой id; не больше 5 в сутки с одного адреса для
 * гостей и аккаунтов младше 7 дней (защита от множества аккаунтов; старые аккаунты по адресу не
 * ограничиваются — у мобильных операторов сотни людей выходят с одного IP); недоступен с одноразовых
 * почтовых доменов. Любых анализов — не больше 20 в сутки на владельца. Частота — 3 в минуту.
 */

import { createHmac } from 'node:crypto';
import { isIPv6 } from 'node:net';
import { PLATFORM_LIMITS } from '../services/discovery-limits.js';

// Числа — из services/discovery-limits.ts (одно место для сервера и сайта).
export const FREE_PER_OWNER_PER_DAY = PLATFORM_LIMITS.analyses.freePerDay;
export const FREE_PER_IP_PER_DAY = PLATFORM_LIMITS.analyses.freePerIpPerDay;
export const YOUNG_ACCOUNT_MS = PLATFORM_LIMITS.analyses.youngAccountDays * 24 * 60 * 60 * 1000;
export const ANALYSES_PER_OWNER_PER_DAY = PLATFORM_LIMITS.analyses.perDay;
export const CREATES_PER_MINUTE = PLATFORM_LIMITS.analyses.startsPerMinute;

/** Одноразовые почтовые домены: с них бесплатный анализ недоступен (список пополняется). */
const DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com',
  '1secmail.com',
  'dispostable.com',
  'emailondeck.com',
  'fakeinbox.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'inboxkitten.com',
  'mail.tm',
  'maildrop.cc',
  'mailinator.com',
  'minuteinbox.com',
  'mintemail.com',
  'moakt.com',
  'mohmal.com',
  'mytemp.email',
  'sharklasers.com',
  'temp-mail.io',
  'temp-mail.org',
  'tempmail.com',
  'tempmailo.com',
  'tempr.email',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
]);

export function isDisposableEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  if (!domain) return false;
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  // Поддомены тех же сервисов (например, x.mailinator.com).
  return [...DISPOSABLE_DOMAINS].some((item) => domain.endsWith(`.${item}`));
}

/** Ключ адреса для лимита: IPv4 целиком, IPv6 — подсеть /64 (у одного абонента их много). */
export function ipKey(ip: string): string {
  const value = ip.trim().toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped) return mapped[1];
  if (!isIPv6(value)) return value;
  const [head, tail = ''] = value.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = value.includes('::') ? 8 - headParts.length - tailParts.length : 0;
  const full = [...headParts, ...Array<string>(Math.max(0, missing)).fill('0'), ...tailParts];
  return `${full
    .slice(0, 4)
    .map((part) => part.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

/** HMAC адреса: сам IP в базе не хранится. */
export function hashIp(ip: string, secret: string): string {
  return createHmac('sha256', `ketner:discovery-ip:v1:${secret}`).update(ipKey(ip)).digest('hex');
}

export function isYoungAccount(createdAt: string | undefined, now: number): boolean {
  if (!createdAt) return true;
  const time = Date.parse(createdAt);
  return Number.isNaN(time) || now - time < YOUNG_ACCOUNT_MS;
}
