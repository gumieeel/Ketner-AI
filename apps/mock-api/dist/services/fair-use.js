/**
 * Fair Use Engine — защита от злоупотреблений, контроль нагрузки и себестоимости.
 *
 * Анализирует активность пользователя в скользящих окнах (минута, час, день)
 * и сравнивает с лимитами его тарифного плана.
 */
import { EntitlementService } from './entitlement.js';
export class FairUseEngine {
    /**
     * Оценить активность пользователя и принять решение (allow / throttle / deny).
     */
    static evaluate(snapshot, userPlan, language = 'ru', options = {}) {
        const limits = EntitlementService.getEntitlements(userPlan);
        // 1. Проверка параллелизма (Concurrency Limit)
        if (snapshot.activeConcurrentRequests >= limits.maxConcurrency) {
            const reason = language === 'en'
                ? `Another reply is still being written. Please wait for it to finish.`
                : `Предыдущий ответ ещё пишется. Дождитесь его завершения.`;
            return {
                action: 'deny',
                code: 'concurrency_limit',
                reason,
            };
        }
        // 2. Проверка запросов в минуту (RPM)
        if (limits.requestsPerMinute !== null && snapshot.requestsLastMinute >= limits.requestsPerMinute) {
            const reason = language === 'en'
                ? `Too many messages in a row. Please slow down a little.`
                : `Слишком много сообщений подряд. Сделайте небольшую паузу.`;
            return {
                action: 'throttle',
                delayMs: 2000,
                reason,
            };
        }
        // 3. Проверка запросов в час (RPH)
        if (limits.requestsPerHour !== null && snapshot.requestsLastHour >= limits.requestsPerHour) {
            const reason = language === 'en'
                ? `You have sent a lot of messages. Please try again later.`
                : `Сообщений было много. Попробуйте чуть позже.`;
            return {
                action: 'deny',
                code: 'rate_limited',
                reason,
            };
        }
        // 4. Проверка запросов в день (RPD)
        if (limits.requestsPerDay !== null && snapshot.requestsLastDay >= limits.requestsPerDay) {
            const reason = language === 'en'
                ? `Messages are used up for today. Try again tomorrow or upgrade your plan.`
                : `Сообщения на сегодня закончились. Продолжите завтра или на платном тарифе.`;
            return {
                action: 'deny',
                code: 'rate_limited',
                reason,
            };
        }
        // 5. Проверка дневного лимита себестоимости (Cost Guard)
        const dailyCostCap = limits.maxDailyCost === null ? null : limits.maxDailyCost * (options.dailyCostFactor ?? 1);
        if (dailyCostCap !== null && snapshot.estimatedCostLastDay >= dailyCostCap) {
            const reason = language === 'en'
                ? `Usage is paused until tomorrow under the fair-use policy.`
                : `По правилам честного использования работа продолжится завтра.`;
            return {
                action: 'deny',
                code: 'fair_use_exceeded',
                reason,
            };
        }
        // 6. Проверка лимита токенов в час
        if (options.skipTokenWindows) {
            return { action: 'allow' };
        }
        if (limits.tokensPerHour !== null && snapshot.tokensLastHour >= limits.tokensPerHour) {
            const reason = language === 'en'
                ? `You have done a lot of work in the last hour. Please take a short break.`
                : `За последний час было очень много работы. Сделайте небольшую паузу.`;
            return {
                action: 'deny',
                code: 'rate_limited',
                reason,
            };
        }
        // 7. Проверка лимита токенов в сутки
        if (limits.tokensPerDay !== null && snapshot.tokensLastDay >= limits.tokensPerDay) {
            const reason = language === 'en'
                ? `Usage is paused for now. It will be available again within a day.`
                : `Работа на время приостановлена. Доступ вернётся в течение суток.`;
            return {
                action: 'deny',
                code: 'rate_limited',
                reason,
            };
        }
        return { action: 'allow' };
    }
}
