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
    static evaluate(snapshot, userPlan, language = 'ru') {
        const limits = EntitlementService.getEntitlements(userPlan);
        // 1. Проверка параллелизма (Concurrency Limit)
        if (snapshot.activeConcurrentRequests >= limits.maxConcurrency) {
            const reason = language === 'en'
                ? `Concurrency limit reached (${limits.maxConcurrency} active request(s)). Please wait for the ongoing response to complete.`
                : `Превышен лимит параллельных запросов (${limits.maxConcurrency} активных). Дождитесь завершения текущего ответа.`;
            return {
                action: 'deny',
                code: 'concurrency_limit',
                reason,
            };
        }
        // 2. Проверка запросов в минуту (RPM)
        if (limits.requestsPerMinute !== null && snapshot.requestsLastMinute >= limits.requestsPerMinute) {
            const reason = language === 'en'
                ? `Too many requests per minute (${snapshot.requestsLastMinute}/${limits.requestsPerMinute}). Please slow down.`
                : `Слишком много запросов в минуту (${snapshot.requestsLastMinute}/${limits.requestsPerMinute}). Пожалуйста, снизьте частоту запросов.`;
            return {
                action: 'throttle',
                delayMs: 2000,
                reason,
            };
        }
        // 3. Проверка запросов в час (RPH)
        if (limits.requestsPerHour !== null && snapshot.requestsLastHour >= limits.requestsPerHour) {
            const reason = language === 'en'
                ? `Hourly request limit reached (${snapshot.requestsLastHour}/${limits.requestsPerHour}). Limit resets in an hour.`
                : `Достигнут часовой лимит запросов (${snapshot.requestsLastHour}/${limits.requestsPerHour}). Лимит обновится в течение часа.`;
            return {
                action: 'deny',
                code: 'rate_limited',
                reason,
            };
        }
        // 4. Проверка запросов в день (RPD)
        if (limits.requestsPerDay !== null && snapshot.requestsLastDay >= limits.requestsPerDay) {
            const reason = language === 'en'
                ? `Daily request limit reached (${snapshot.requestsLastDay}/${limits.requestsPerDay}). Upgrade your plan for higher limits.`
                : `Достигнут дневной лимит сообщений (${snapshot.requestsLastDay}/${limits.requestsPerDay}). Улучшите тариф для увеличения лимитов.`;
            return {
                action: 'deny',
                code: 'rate_limited',
                reason,
            };
        }
        // 5. Проверка дневного лимита себестоимости (Cost Guard)
        if (limits.maxDailyCost !== null && snapshot.estimatedCostLastDay >= limits.maxDailyCost) {
            const reason = language === 'en'
                ? `Fair Use Policy: daily usage quota exceeded ($${snapshot.estimatedCostLastDay.toFixed(2)} / $${limits.maxDailyCost.toFixed(2)}). Service will resume tomorrow.`
                : `Политика добросовестного использования (Fair Use): превышена дневная квота ресурсов ($${snapshot.estimatedCostLastDay.toFixed(2)} / $${limits.maxDailyCost.toFixed(2)}). Доступ восстановится завтра.`;
            return {
                action: 'deny',
                code: 'fair_use_exceeded',
                reason,
            };
        }
        // 6. Проверка лимита токенов в час
        if (limits.tokensPerHour !== null && snapshot.tokensLastHour >= limits.tokensPerHour) {
            const reason = language === 'en'
                ? `Hourly token quota reached (${Math.round(snapshot.tokensLastHour / 1000)}k tokens). Please wait before asking large tasks.`
                : `Достигнута часовая квота токенов (${Math.round(snapshot.tokensLastHour / 1000)}k токенов). Сделайте небольшую паузу.`;
            return {
                action: 'deny',
                code: 'rate_limited',
                reason,
            };
        }
        return { action: 'allow' };
    }
}
