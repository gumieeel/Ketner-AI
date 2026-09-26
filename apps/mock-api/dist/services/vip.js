import { config } from '../config.js';
/**
 * Проверка, является ли email VIP / Ultra адресом.
 * Сверяется со списком config.vipEmails (по умолчанию artemsinyakov09@gmail.com,
 * переопределяется через переменную окружения VIP_EMAILS).
 */
export function isVipEmail(email) {
    if (!email)
        return false;
    return config.vipEmails.includes(email.trim().toLowerCase());
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
 * Сверяется со списком config.adminEmails (по умолчанию artemsinyakov09@gmail.com,
 * переопределяется через переменную окружения ADMIN_EMAILS).
 */
export function isAdminEmail(email) {
    if (!email)
        return false;
    return config.adminEmails.includes(email.trim().toLowerCase());
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
