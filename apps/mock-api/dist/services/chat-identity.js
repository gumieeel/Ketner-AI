/**
 * Определение личности и тарифа для запроса к чату.
 *
 * Функция принимает только серверные данные (сессия, профиль, подписка). Тело HTTP-запроса сюда
 * не передаётся вообще, поэтому клиент не может ни назваться другим пользователем, ни повысить
 * себе тариф полями userId / userEmail / userPlan (уязвимость C8).
 */
import { isVipEmail, isVipUser } from './vip.js';
import { resolveBillingPlan } from './plan-resolver.js';
export function resolveChatIdentity(input) {
    const { sessionUser } = input;
    if (!sessionUser) {
        if (!input.allowAnonymous) {
            return {
                ok: false,
                status: 401,
                code: 'unauthorized',
                message: 'Войдите в аккаунт, чтобы пользоваться чатом',
            };
        }
        // Анонимный режим (только вне production): общий demo-user, всегда бесплатный план.
        return {
            ok: true,
            userId: input.anonymousUserId,
            plan: input.anonymousPlan,
            isVip: false,
            anonymous: true,
        };
    }
    const email = sessionUser.email || input.storedUser?.email || undefined;
    const isVip = isVipUser(sessionUser) || isVipUser(input.storedUser) || isVipEmail(email);
    const plan = resolveBillingPlan({
        storedPlan: input.storedUser?.plan ?? sessionUser.plan,
        subscription: input.subscription,
        isVip,
        now: input.now,
    }).plan;
    return { ok: true, userId: sessionUser.id, email, plan, isVip, anonymous: false };
}
