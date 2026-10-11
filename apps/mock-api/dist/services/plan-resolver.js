/**
 * Эффективный тариф пользователя с учётом срока подписки.
 *
 * Оплата криптой и Telegram Stars разовая: `renewsAt` ставится на 30 дней вперёд и дальше
 * никто не продлевает подписку сам. Без этой проверки одна оплата давала тариф навсегда.
 * Функция чистая — без обращений к хранилищам, поэтому проверяется юнит-тестами без сервера.
 */
/** Запас после окончания периода: задержка вебхука продления не должна обрывать работу. */
export const SUBSCRIPTION_GRACE_MS = 24 * 60 * 60 * 1000;
export function resolveBillingPlan(input) {
    if (input.isVip) {
        return { plan: 'ultra', expired: false };
    }
    const stored = input.storedPlan ?? 'free';
    if (stored === 'free') {
        return { plan: 'free', expired: false };
    }
    const sub = input.subscription;
    if (!sub || sub.plan === 'free') {
        // Записи о платеже нет (старые данные или ручная правка профиля) — тариф не трогаем.
        return { plan: stored, expired: false };
    }
    const now = input.now ?? Date.now();
    const endsAt = sub.renewsAt ? Date.parse(sub.renewsAt) : Number.NaN;
    if (sub.status === 'canceled') {
        // Отменённая подписка действует до конца оплаченного периода и не дольше.
        if (Number.isNaN(endsAt) || now > endsAt) {
            return { plan: 'free', expired: true };
        }
        return { plan: stored, expired: false };
    }
    if (!Number.isNaN(endsAt) && now > endsAt + SUBSCRIPTION_GRACE_MS) {
        return { plan: 'free', expired: true };
    }
    return { plan: stored, expired: false };
}
