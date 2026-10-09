import { config } from '../config.js';
/**
 * Проверка, является ли email VIP / Ultra адресом.
 * Сверяется только со списком config.vipEmails (переменная окружения VIP_EMAILS).
 */
export function isVipEmail(email) {
    if (!email)
        return false;
    const normalized = email.trim().toLowerCase();
    return config.vipEmails.includes(normalized);
}
/**
 * Проверка, является ли пользователь VIP пользователем (по флагу или email).
 */
export function isVipUser(user) {
    if (!user)
        return false;
    if (user.isVip)
        return true;
    return isVipEmail(user.email);
}
/**
 * Проверка, является ли email адресом администратора.
 * Сверяется только со списком config.adminEmails (переменная окружения ADMIN_EMAILS).
 * Адреса вида admin@... админами не считаются: регистрация не подтверждает владение почтой.
 */
export function isAdminEmail(email) {
    if (!email)
        return false;
    const normalized = email.trim().toLowerCase();
    return config.adminEmails.includes(normalized);
}
/**
 * Проверка, является ли пользователь администратором (по флагу isAdmin или email).
 */
export function isAdminUser(user) {
    if (!user)
        return false;
    if (user.isAdmin)
        return true;
    return isAdminEmail(user.email);
}
