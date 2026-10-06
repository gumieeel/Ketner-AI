import { config } from '../config.js';
import type { User } from '../types.js';

/**
 * Проверка, является ли email VIP / Ultra адресом.
 * Сверяется только со списком config.vipEmails (переменная окружения VIP_EMAILS).
 */
export function isVipEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return config.vipEmails.includes(normalized);
}

/**
 * Проверка, является ли пользователь VIP пользователем (по флагу или email).
 */
export function isVipUser(
  user?: Partial<User> | { email?: string; isVip?: boolean; role?: string } | null,
): boolean {
  if (!user) return false;
  if (user.isVip) return true;
  return isVipEmail(user.email);
}

/**
 * Проверка, является ли email адресом администратора.
 * Сверяется только со списком config.adminEmails (переменная окружения ADMIN_EMAILS).
 * Адреса вида admin@... админами не считаются: регистрация не подтверждает владение почтой.
 */
export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return config.adminEmails.includes(normalized);
}

/**
 * Проверка, является ли пользователь администратором (по флагу isAdmin или email).
 */
export function isAdminUser(
  user?: Partial<User> | { email?: string; isAdmin?: boolean; role?: string } | null,
): boolean {
  if (!user) return false;
  if (user.isAdmin) return true;
  return isAdminEmail(user.email);
}
