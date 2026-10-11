/**
 * Применение суточных лимитов моделей (см. services/daily-limits.ts).
 *
 * Если модель исчерпала суточный лимит тарифа, берётся её запасная модель из реестра; если и у неё
 * лимит исчерпан, то следующая по цепочке. Цепочка конечна и без повторов, а модели без запасной
 * (или с отключённой запасной) остаются как есть: лучше ответить, чем отказать.
 */
import { getDailyModelLimit } from '../services/daily-limits.js';
/** Исчерпан ли суточный лимит модели у пользователя. */
export function isDailyLimitReached(model, plan, userId, usage, registry) {
    const limit = getDailyModelLimit(plan, model.id);
    if (limit === null)
        return false;
    return usage.getModelUsesLastDay(userId, registry.getIdsWithAliases(model.id)) >= limit;
}
export function applyDailyLimits(model, plan, userId, usage, registry) {
    let current = model;
    const seen = new Set();
    let first;
    while (!seen.has(current.id) && isDailyLimitReached(current, plan, userId, usage, registry)) {
        seen.add(current.id);
        const next = current.fallbackModelId ? registry.get(current.fallbackModelId) : undefined;
        if (!next || !next.enabled || seen.has(next.id))
            break;
        if (!first)
            first = { model: current, limit: getDailyModelLimit(plan, current.id) ?? 0 };
        current = next;
    }
    if (!first)
        return { model, reason: null };
    return {
        model: current,
        limited: first,
        reason: `Daily limit reached for ${first.model.name} (${first.limit}/day on ${plan}): ${current.name} answers instead`,
    };
}
