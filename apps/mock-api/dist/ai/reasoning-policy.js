/**
 * Политика глубины размышлений.
 *
 * Современные модели размышляют по умолчанию, а токены размышлений оплачиваются как выходные
 * (у GPT-6 Luna размышления включены на среднем уровне, у Opus 5.5, Sol, Grok и Gemini 3.8 их
 * вообще нельзя отключить). Без управления простой вопрос стоит как сложная задача.
 *
 * Вместо подмены модели на «лёгкую» (как было раньше, пользователь получал не ту модель, которую
 * выбрал) мы оставляем выбранную модель и меняем глубину размышлений: по данным Artificial Analysis
 * режим low у GPT-6.1 Sol в 2.5 раза дешевле high, у Claude Opus 5.5 в 3.3 раза.
 */
import { planRank } from '../services/entitlement.js';
const ORDER = ['none', 'low', 'medium', 'high'];
const PREMIUM_CLASSES = new Set(['strong', 'top']);
/**
 * Категории, где глубина размышлений заметно влияет на правильность ответа. Только математика:
 * код и так идёт на сильную модель, а «рассуждения» классификатор отмечает по ключевым словам
 * («объясни», «почему», «сравни»), то есть почти любой вопрос. Глубина high стоит в 2.5–3.3 раза
 * дороже low, и тратить на каждое «объясни» квоту премиум-запросов тарифа нельзя.
 */
const HARD_CATEGORIES = new Set(['math']);
/**
 * Желаемая глубина размышлений для запроса.
 *
 *   simple   → none   (приветствие, короткий вопрос)
 *   moderate → low
 *   complex  → medium
 *   complex  → high   только если глубина реально окупается: Ultra на top-модели
 *                     либо математика на премиум-модели у Pro и выше.
 * При расходе бюджета (soft и выше) глубина ограничивается уровнем low.
 */
export function chooseReasoningEffort(input) {
    let index = input.level === 'simple' ? 0 : input.level === 'moderate' ? 1 : 2;
    if (input.level === 'complex') {
        const rank = planRank(input.plan);
        const premium = PREMIUM_CLASSES.has(input.costClass);
        const heavyTop = input.costClass === 'top' && rank >= planRank('ultra');
        const heavyCategory = premium && rank >= planRank('pro') && HARD_CATEGORIES.has(input.category);
        if (heavyTop || heavyCategory) {
            index = 3;
        }
    }
    if (input.escalate && index < 2 && !PREMIUM_CLASSES.has(input.costClass)) {
        index += 1;
    }
    if (input.stage !== 'normal') {
        index = Math.min(index, 1);
    }
    return ORDER[index];
}
function nearestSupported(supported, wanted, mandatory) {
    const allowed = supported.filter((e) => !(mandatory && e === 'none'));
    if (allowed.includes(wanted))
        return wanted;
    const target = ORDER.indexOf(wanted);
    const preferHigher = wanted === 'medium' || wanted === 'high';
    let best = allowed[0];
    let bestDistance = Infinity;
    for (const effort of allowed) {
        const distance = Math.abs(ORDER.indexOf(effort) - target);
        const better = distance < bestDistance ||
            (distance === bestDistance &&
                (preferHigher
                    ? ORDER.indexOf(effort) > ORDER.indexOf(best)
                    : ORDER.indexOf(effort) < ORDER.indexOf(best)));
        if (better) {
            best = effort;
            bestDistance = distance;
        }
    }
    return best;
}
/**
 * Приводит желаемую глубину к тому, что модель реально принимает. Отправлять значение, которого
 * нет в списке модели, нельзя: OpenRouter ответит ошибкой. Если управлять нечем, параметр не
 * передаётся и модель работает со своим значением по умолчанию.
 */
export function toProviderReasoning(reasoning, wanted) {
    if (reasoning.efforts.length > 0) {
        return { effort: nearestSupported(reasoning.efforts, wanted, reasoning.mandatory) };
    }
    if (reasoning.toggle) {
        return { enabled: reasoning.mandatory ? true : wanted !== 'none' };
    }
    return undefined;
}
export function isPremiumClass(costClass) {
    return PREMIUM_CLASSES.has(costClass);
}
/** Нижняя граница: ответ с размышлениями короче этого обрывается, не успев начаться. */
const MIN_OUTPUT_CAP = 1024;
/**
 * Предельное число выходных токенов (размышления входят в него).
 *
 * Выходные токены — самая дорогая часть запроса, поэтому потолок следует за расходом бюджета:
 * в экономном режиме ответ не длиннее 4096 токенов, при исчерпании бюджета — 2048. Простой
 * вопрос без проекта и файлов тоже не требует длинного ответа. Платится только фактически
 * сгенерированное, потолок защищает от самого дорогого сценария: модель, которая «разговорилась».
 */
export function computeOutputCap(input) {
    let cap = Math.min(input.modelMaxOutputTokens, input.planMaxTokens);
    if (input.stage === 'soft')
        cap = Math.min(cap, 4096);
    if (input.stage === 'exhausted' || input.stage === 'hard_stop')
        cap = Math.min(cap, 2048);
    if (input.level === 'simple' && !input.heavyContext)
        cap = Math.min(cap, 2048);
    return Math.max(cap, Math.min(MIN_OUTPUT_CAP, input.modelMaxOutputTokens));
}
