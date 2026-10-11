/**
 * AI Gateway — центральный шлюз оркестрации AI-запросов Ketner AI.
 *
 * Объединяет:
 * - Model Registry (каталог моделей и их классы стоимости)
 * - Provider Manager (единый канал OpenRouter: один ключ на все модели)
 * - Entitlement Service (проверка прав и тарифов)
 * - Fair Use Engine (rate limits, concurrency, суточные квоты)
 * - Budget Policy (месячный бюджет себестоимости и квота премиум-запросов)
 * - Reasoning Policy (глубина размышлений и потолок ответа)
 * - Context Optimizer (оптимизация контекста)
 * - Usage Accounting & Cost Calculator (учёт токенов и себестоимости)
 * - Fallback & Failover (запасные модели из реестра, предохранитель на каждую модель)
 *
 * Принцип: запрошенная пользователем модель не подменяется скрытно. Если её приходится заменить
 * (исчерпана квота премиум-запросов, бюджет на исходе, сбой провайдера), в ответе возвращается
 * реальная модель (`selectedModel`) и причина (`routingReason`), а расход пишется по цене именно
 * той модели, которая ответила.
 */
import { ERROR_MESSAGES, pickAnswer } from './answers.js';
import { semanticCache, SemanticCache } from './cache.js';
import { ContextOptimizer } from './context.js';
import { modelRegistry, ECONOMY_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT, FLOOR_MODEL_ID, WORKHORSE_MODEL_ID, } from './model-registry.js';
import { providerManager } from './providers/provider-factory.js';
import { OpenRouterError } from './providers/openrouter-provider.js';
import { delay, streamText } from './stream.js';
import { isProduction } from '../config.js';
import { EntitlementService, planAllowsModel } from '../services/entitlement.js';
import { FairUseEngine } from '../services/fair-use.js';
import { AutoRouter } from './auto-router.js';
import { feedbackStore as defaultFeedbackStore } from '../store/index.js';
import { chooseReasoningEffort, computeOutputCap, isPremiumClass, toProviderReasoning, } from './reasoning-policy.js';
import { CircuitBreaker, defaultCircuitBreaker } from './circuit-breaker.js';
import { computeRequestCost } from './engine-pricing.js';
import { createStreamWatchdog, DEFAULT_WATCHDOG_LIMITS } from './stream-watchdog.js';
import { evaluateBudget } from '../services/budget-policy.js';
import { PayloadGuard } from './payload-guard.js';
import { buildAttachmentsBlock, buildWorkspaceContextBlock, workspaceBudgetChars, } from './workspace-context.js';
export function classifyPromptComplexity(prompt, context) {
    if (!prompt || !prompt.trim()) {
        return { level: 'complex', category: 'general' };
    }
    // Если есть вложения или проект — задача сразу переходит в категорию сложных
    if (context?.hasAttachments || context?.hasWorkspace) {
        return { level: 'complex', category: 'coding' };
    }
    const classification = AutoRouter.classify(prompt);
    const trimmed = prompt.trim();
    // Проверка истории: если в недавней истории был сложный контекст (код, длинные ответы, рассуждения),
    // то короткая реплика («да», «продолжи», «ок») не должна сбрасывать сложность на deepseek
    const historyIsComplex = Boolean(context?.history &&
        context.history.length > 0 &&
        context.history.slice(-4).some((m) => {
            const text = m.content || '';
            return (text.length > 250 ||
                /```|function|class|interface|import|export|select|def |const |let |error|exception/i.test(text));
        }));
    const hasCodeOrTechnicalSyntax = /```|<pre>|SELECT\s+[\s\S]*?\s+FROM|INSERT\s+INTO|UPDATE\s+[\s\S]*?SET|CREATE\s+TABLE|function\s*\(|def\s+\w+\(|class\s+\w+|const\s+\w+\s*=|let\s+\w+\s*=|import\s+[\s\S]*?from|export\s+(default|const|class)|interface\s+\w+/i.test(trimmed);
    // 1. "Прям лёгкие вопросы": приветствия, благодарности, подтверждения, короткие реплики
    const isGreetingOrChitChat = /^(привет|хай|здравствуй|добр(ое|ый|ый день|ое утро|ый вечер)|hello|hi|hey|как дела|кто ты|что ты умеешь|спасибо|благодарю|ок|ok|ясно|понятно)[\s!?,.]*$/i.test(trimmed);
    const isTrivialGeneral = trimmed.length < 50 &&
        classification.complexity === 'simple' &&
        classification.category === 'general' &&
        !/(напиши|составь|придумай|объясни|расскажи|переведи|write|explain|translate|код|функци)/i.test(trimmed);
    if ((isGreetingOrChitChat || isTrivialGeneral) && !historyIsComplex && !hasCodeOrTechnicalSyntax) {
        return { level: 'simple', category: classification.category };
    }
    // 2. Сложные задачи: глубокий код, математика, архитектура, системный дизайн, длинные формулировки (>500 символов)
    const isComplex = classification.complexity === 'complex' ||
        classification.category === 'coding' ||
        classification.category === 'math' ||
        classification.category === 'reasoning' ||
        classification.category === 'research' ||
        hasCodeOrTechnicalSyntax ||
        trimmed.length > 500 ||
        historyIsComplex;
    if (isComplex) {
        return { level: 'complex', category: hasCodeOrTechnicalSyntax ? 'coding' : classification.category };
    }
    // 3. Умеренные / стандартные задачи
    return { level: 'moderate', category: classification.category };
}
const JCUKEN_MAP = {
    q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з', '[': 'х', ']': 'ъ',
    a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о', k: 'л', l: 'д', ';': 'ж', "'": 'э',
    z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и', n: 'т', m: 'ь', ',': 'б', '.': 'ю', '`': 'ё',
    Q: 'Й', W: 'Ц', E: 'У', R: 'К', T: 'Е', Y: 'Н', U: 'Г', I: 'Ш', O: 'Щ', P: 'З', '{': 'Х', '}': 'Ъ',
    A: 'Ф', S: 'Ы', D: 'В', F: 'А', G: 'П', H: 'Р', J: 'О', K: 'Л', L: 'Д', ':': 'Ж', '"': 'Э',
    Z: 'Я', X: 'Ч', C: 'С', V: 'М', B: 'И', N: 'Т', M: 'Ь', '<': 'Б', '>': 'Ю', '~': 'Ё',
};
export function convertLayoutIfInverted(input) {
    if (!input || input.trim().length === 0)
        return input;
    const hasLatin = /[a-zA-Z]/.test(input);
    const hasCyrillic = /[а-яА-ЯёЁ]/.test(input);
    if (!hasLatin || hasCyrillic)
        return input;
    const converted = input
        .split('')
        .map((ch) => JCUKEN_MAP[ch] ?? ch)
        .join('');
    const ruPatterns = /(анализ|репозитор|проект|файл|сдела|помог|напиш|объясн|ошибк|папк|ветк|функц|компонент|скрипт|привет|как|что|где|почему)/i;
    if (ruPatterns.test(converted)) {
        return converted;
    }
    return input;
}
/**
 * Правила экономии для явно выбранной модели. Вызывается после проверки прав доступа.
 *
 *  - бюджет исчерпан → любая модель, кроме лёгких, заменяется на самую дешёвую;
 *  - премиум-модель (классы strong и top): квота премиум-запросов тарифа исчерпана или бюджет на
 *    исходе (soft) → ответит рабочая модель, а не «ничего»: пользователь продолжает работать.
 */
export function applyEconomyRules(requested, state, registry) {
    if (state.stage === 'exhausted' || state.stage === 'hard_stop') {
        if (requested.costClass !== 'lite') {
            const floor = registry.resolve(FLOOR_MODEL_ID);
            return {
                model: floor,
                reason: `Budget protection: monthly quota is used up, ${floor.name} answers instead of ${requested.name}`,
            };
        }
        return { model: requested, reason: null };
    }
    if (isPremiumClass(requested.costClass)) {
        if (!state.premiumAvailable) {
            const workhorse = registry.resolve(WORKHORSE_MODEL_ID);
            return {
                model: workhorse,
                reason: `Premium quota used up: ${workhorse.name} answers instead of ${requested.name}`,
            };
        }
        if (state.stage === 'soft') {
            const workhorse = registry.resolve(WORKHORSE_MODEL_ID);
            return {
                model: workhorse,
                reason: `Budget protection: ${workhorse.name} answers instead of ${requested.name}`,
            };
        }
    }
    return { model: requested, reason: null };
}
export class AIGateway {
    registry;
    providers;
    usageStore;
    aiConfig;
    circuitBreaker;
    feedbackStore;
    useMockEngine;
    constructor(deps) {
        this.useMockEngine = deps.useMockEngine;
        this.registry = deps.registry ?? modelRegistry;
        this.providers = deps.providers ?? providerManager;
        this.usageStore = deps.usageStore;
        this.aiConfig = deps.aiConfig;
        this.circuitBreaker = deps.circuitBreaker ?? defaultCircuitBreaker;
        this.feedbackStore = deps.feedbackStore ?? defaultFeedbackStore;
    }
    /**
     * Один проход стриминга со сторожем: сроки на первый токен, простой и общую длительность
     * вместо единого таймера, обрывавшего любой длинный ответ.
     */
    async streamWithWatchdog(provider, options, hooks) {
        const attempt = new AbortController();
        const limits = {
            ...DEFAULT_WATCHDOG_LIMITS,
            ...(hooks.providerTimeoutMs
                ? {
                    firstTokenMs: hooks.providerTimeoutMs,
                    idleMs: hooks.providerTimeoutMs,
                    totalMs: Math.max(hooks.providerTimeoutMs, DEFAULT_WATCHDOG_LIMITS.totalMs),
                }
                : {}),
        };
        const watchdog = createStreamWatchdog(limits, (reason) => {
            attempt.abort(new Error(`Timeout (${reason}) у провайдера ${provider.type}`));
        });
        const onClientAbort = () => attempt.abort();
        if (hooks.clientSignal.aborted) {
            attempt.abort();
        }
        else {
            hooks.clientSignal.addEventListener('abort', onClientAbort, { once: true });
        }
        try {
            const response = await provider.streamText({ ...options, stream: true, signal: attempt.signal }, {
                onDelta: (delta) => {
                    watchdog.touch();
                    hooks.onDelta(delta);
                },
                isCancelled: () => hooks.isCancelled() || attempt.signal.aborted,
            });
            return { response, timedOut: watchdog.reason !== null };
        }
        finally {
            watchdog.stop();
            hooks.clientSignal.removeEventListener('abort', onClientAbort);
        }
    }
    /** Расхождение запрошенного и фактического движка — это почти всегда неверный ID модели. */
    reportedMismatches = new Set();
    noteEngineMismatch(requested, actual) {
        if (!actual || actual === requested)
            return;
        const family = (id) => id.split(':')[0].toLowerCase();
        if (family(actual).startsWith(family(requested)) || family(requested).startsWith(family(actual)))
            return;
        const key = `${requested}->${actual}`;
        if (this.reportedMismatches.has(key))
            return;
        this.reportedMismatches.add(key);
        console.warn(`[ai-gateway] Запрошен движок ${requested}, ответил ${actual}. Проверьте ID модели в реестре.`);
    }
    getCircuitBreaker() {
        return this.circuitBreaker;
    }
    getFeedbackStore() {
        return this.feedbackStore;
    }
    /**
     * Запасная модель допустима, если она не нарушает правил экономии: премиум-модель берётся
     * только пока есть квота премиум-запросов, а при исчерпанном бюджете — только лёгкие модели.
     * Прав доступа по тарифу для запасных не требуется: они дешевле выбранной, а пользователь
     * видит в ответе, какая модель реально ответила.
     */
    isAllowedFallback(model, plan, state) {
        if (state.stage === 'exhausted' || state.stage === 'hard_stop') {
            return model.costClass === 'lite';
        }
        if (isPremiumClass(model.costClass)) {
            return (state.stage === 'normal' &&
                state.premiumAvailable &&
                planAllowsModel(plan, model.requiredPlan));
        }
        return true;
    }
    /**
     * Стриминговая генерация ответа через AI Gateway.
     */
    async stream(req, callbacks, isCancelled) {
        const startTime = Date.now();
        const activeUserId = req.userId;
        const language = req.language;
        // 0. Payload Guard (валидация размера сообщений и вложений)
        const guardResult = PayloadGuard.validate(req.messages, {
            language,
            attachments: req.attachments,
            workspace: req.workspaceContext ?? req.messages[req.messages.length - 1]?.workspaceContext,
        });
        if (!guardResult.valid) {
            callbacks.onError({
                code: guardResult.code ?? 'payload_too_large',
                message: guardResult.message ?? ERROR_MESSAGES[language],
            });
            return;
        }
        const clientAbortController = new AbortController();
        if (req.signal) {
            if (req.signal.aborted) {
                clientAbortController.abort();
            }
            else {
                req.signal.addEventListener('abort', () => clientAbortController.abort(), { once: true });
            }
        }
        const combinedIsCancelled = () => isCancelled() || clientAbortController.signal.aborted;
        // 1. Определение эффективного плана и лимитов
        // Примечание: req.userPlan предварительно резолвится с учётом VIP-элевации (isVipUser -> 'ultra')
        // upstream в chat.ts перед вызовом gateway.stream().
        // EntitlementService.resolveEffectivePlan повторно валидирует план, учитывая переданные
        // req.userEmail и req.isVip, и обеспечивает надёжный fallback на 'free'.
        const effectivePlan = EntitlementService.resolveEffectivePlan(req.userPlan, req.userEmail, req.isVip);
        const entitlements = EntitlementService.getEntitlements(effectivePlan);
        const snapshot = this.usageStore.getFairUseSnapshot(activeUserId);
        // Месячный бюджет себестоимости: soft (80%) → exhausted (100%, только дешёвые модели) →
        // hard_stop (125%, запросы отклоняются). Без потолка «безлимит» мог уйти в убыток.
        const budget = evaluateBudget(snapshot.estimatedCostLastMonth, entitlements.costBudget);
        const stage = budget.stage;
        if (stage === 'hard_stop') {
            this.usageStore.recordUsage({
                userId: activeUserId,
                conversationId: req.conversationId,
                modelId: req.modelId,
                provider: 'openrouter',
                inputTokens: 0,
                outputTokens: 0,
                estimatedCost: 0,
                latencyMs: Date.now() - startTime,
                status: 'rate_limited',
                source: 'provider',
            });
            callbacks.onError({
                code: 'fair_use_exceeded',
                message: language === 'en'
                    ? 'Your plan resource quota for this period is used up. It renews gradually; you can upgrade your plan for a higher quota.'
                    : 'Ресурсная квота вашего тарифа на этот период исчерпана. Она восстанавливается постепенно; для большей квоты можно повысить тариф.',
            });
            return;
        }
        // Квота премиум-запросов: сколько тариф разрешает потратить на сильные модели за 30 дней.
        const premiumSpent = this.usageStore.getCostLastMonthByModels(activeUserId, this.registry.getPremiumModelIds());
        const premiumAvailable = entitlements.premiumBudget - premiumSpent > 0;
        const economyState = { stage, premiumAvailable };
        // 2. Анализ запроса
        const rawPrompt = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
        const decodedPrompt = convertLayoutIfInverted(rawPrompt);
        const prompt = decodedPrompt;
        // Проект берётся только из ПОСЛЕДНЕГО сообщения: клиент прикладывает его к каждой реплике, пока
        // проект привязан. Раньше брался и более ранний «метаданный» контекст, и после отвязки проекта
        // модель продолжала считать, что у неё есть полный доступ к нулевому набору файлов.
        const lastMessage = req.messages[req.messages.length - 1];
        const activeWorkspace = req.workspaceContext ?? lastMessage?.workspaceContext;
        const activeAttachments = req.attachments ??
            lastMessage?.attachments ??
            req.messages
                .slice(-8)
                .reverse()
                .find((m) => m.attachments && m.attachments.length > 0)?.attachments;
        const complexityContext = {
            history: req.messages.slice(0, -1),
            hasAttachments: Boolean(activeAttachments && activeAttachments.length > 0),
            hasWorkspace: Boolean(activeWorkspace),
        };
        const taskInfo = classifyPromptComplexity(prompt, complexityContext);
        const hasWorkspaceOrAttachments = Boolean(activeWorkspace || (activeAttachments && activeAttachments.length > 0));
        // 3. Выбор модели
        let targetModel;
        let routingReason;
        if (req.isAnonymous && (req.modelId === 'auto' || req.modelId === 'nemotron-ultra' || !req.modelId)) {
            targetModel = this.registry.resolve('nemotron-ultra');
            routingReason = 'Guest mode: nvidia/nemotron-3-ultra-550b-a55b:free via OpenRouter';
        }
        else if (req.modelId === 'auto' || !req.modelId) {
            const routed = AutoRouter.route({
                plan: effectivePlan,
                level: taskInfo.level,
                category: taskInfo.category,
                stage,
                premiumAvailable,
            });
            targetModel = this.registry.resolve(routed.modelId);
            routingReason = routed.reason;
        }
        else {
            const requested = this.registry.resolve(req.modelId);
            // Права доступа проверяются по запрошенной модели ДО любой замены: иначе бесплатный
            // пользователь, выбравший недоступную модель, молча получил бы другую вместо предложения
            // улучшить тариф.
            const accessCheck = EntitlementService.checkModelAccess(requested, effectivePlan);
            if (!accessCheck.allowed) {
                const msg = language === 'en'
                    ? `Access to ${requested.name} requires an active subscription (${accessCheck.requiredPlan} or higher). Please upgrade your plan.`
                    : `Для доступа к модели ${requested.name} требуется подписка (${accessCheck.requiredPlan} или выше). Пожалуйста, улучшите ваш тариф.`;
                callbacks.onError({ code: 'upgrade_required', message: msg });
                return;
            }
            const economy = applyEconomyRules(requested, economyState, this.registry);
            targetModel = economy.model;
            routingReason = economy.reason ?? `Explicit user model selection (${requested.name})`;
        }
        // 4. Проверка Fair Use и захват concurrency слота
        const decision = FairUseEngine.evaluate(snapshot, effectivePlan, language);
        if (decision.action === 'deny') {
            this.usageStore.recordUsage({
                userId: activeUserId,
                conversationId: req.conversationId,
                modelId: targetModel.id,
                provider: targetModel.provider,
                inputTokens: 0,
                outputTokens: 0,
                estimatedCost: 0,
                latencyMs: Date.now() - startTime,
                status: decision.code === 'concurrency_limit' ? 'concurrency_limited' : 'rate_limited',
                source: 'provider',
            });
            callbacks.onError({
                code: decision.code,
                message: decision.reason,
            });
            return;
        }
        if (decision.action === 'throttle') {
            await delay(decision.delayMs);
        }
        const releaseSlot = this.usageStore.acquireConcurrencySlot(activeUserId);
        try {
            // 5. Оптимизация контекста
            const maxContextMessages = Math.min(targetModel.contextMessages, entitlements.maxContextMessages, entitlements.contextLimit);
            // Дифференциация системных промптов по тарифам и Brand Protection:
            // Free / Plus -> ECONOMY_SYSTEM_PROMPT (максимально краткие ответы)
            // Pro / Ultra -> DEFAULT_SYSTEM_PROMPT (глубокие ответы с рассуждениями)
            const isEconomyTier = effectivePlan === 'free' || effectivePlan === 'plus';
            const promptMap = isEconomyTier
                ? ECONOMY_SYSTEM_PROMPT
                : (targetModel.defaultSystemPrompt ?? DEFAULT_SYSTEM_PROMPT);
            const baseSystemPrompt = promptMap[language];
            const systemPrompt = stage !== 'normal'
                ? `${baseSystemPrompt} ${language === 'en' ? 'Keep responses concise and direct.' : 'Отвечай максимально кратко и по существу.'}`
                : baseSystemPrompt;
            // Бюджет проекта зависит от тарифа, окна и цены модели: большой контекст на дорогой модели —
            // главный источник убытка в безлимите.
            const workspaceChars = workspaceBudgetChars(effectivePlan, targetModel.contextWindow, targetModel.pricing.inputPricePerMillion);
            let effectiveSystemPrompt = systemPrompt;
            if (activeWorkspace) {
                const { block, stats } = buildWorkspaceContextBlock(activeWorkspace, {
                    language,
                    query: prompt,
                    maxContentChars: workspaceChars,
                });
                effectiveSystemPrompt += block;
                if (stats.filesWithContent === 0 && stats.filesListed > 0) {
                    console.warn(`[ai-gateway] Проект «${activeWorkspace.name}»: ${stats.filesListed} файлов в списке, но ни у одного нет содержимого`);
                }
            }
            if (activeAttachments && activeAttachments.length > 0) {
                effectiveSystemPrompt += buildAttachmentsBlock(activeAttachments, language, Math.floor(workspaceChars / 2));
            }
            let generatedSummary;
            const optimizedMessages = ContextOptimizer.optimize(req.messages.map((m, idx) => ({
                role: m.role,
                content: idx === req.messages.length - 1 && m.role === 'user' && decodedPrompt !== rawPrompt
                    ? decodedPrompt
                    : m.content,
            })), {
                maxMessages: maxContextMessages,
                maxTokens: targetModel.contextWindow,
                systemPrompt: effectiveSystemPrompt,
                language,
                existingSummary: req.cachedSummary,
                onSummaryGenerated: (summary) => {
                    generatedSummary = summary;
                },
            });
            // 5.1. Проверка семантического кэша (Semantic & Query Caching)
            const userScope = effectivePlan === 'free' ? 'shared' : activeUserId;
            const historyHash = SemanticCache.computeHistoryHash(req.messages, 3);
            const hasAttachments = Boolean(activeAttachments && activeAttachments.length > 0);
            // Ответ зависит от файлов проекта и вложений, а ключ кэша — только от текста вопроса:
            // с проектом/вложениями кэш не читаем и не пишем (иначе чужой или устаревший ответ).
            const cacheable = !hasAttachments && !activeWorkspace;
            const cachedHit = cacheable
                ? semanticCache.get(targetModel.id, language, prompt, userScope, historyHash)
                : null;
            if (cachedHit && !isCancelled()) {
                let cacheTtft = null;
                await streamText(cachedHit.response, {
                    thinkingMs: [5, 10],
                    chunkMs: [5, 10],
                    random: this.aiConfig.random,
                    isCancelled,
                    onDelta: (delta) => {
                        if (cacheTtft === null) {
                            cacheTtft = Date.now() - startTime;
                        }
                        callbacks.onDelta(delta);
                    },
                });
                const latencyMs = Date.now() - startTime;
                this.usageStore.recordUsage({
                    userId: activeUserId,
                    conversationId: req.conversationId,
                    modelId: targetModel.id,
                    provider: targetModel.provider,
                    inputTokens: cachedHit.inputTokens,
                    outputTokens: cachedHit.outputTokens,
                    cachedTokens: cachedHit.inputTokens,
                    estimatedCost: 0,
                    actualCost: 0,
                    latencyMs,
                    ttftMs: cacheTtft,
                    status: 'success',
                    source: 'cache',
                });
                if (!isCancelled()) {
                    callbacks.onDone({
                        inputTokens: cachedHit.inputTokens,
                        outputTokens: cachedHit.outputTokens,
                        selectedModel: { id: targetModel.id, name: targetModel.name },
                        routingReason: `${routingReason} (Semantic Cache Hit)`,
                        source: 'cache',
                        finishReason: 'stop',
                        canContinue: false,
                    });
                }
                return;
            }
            // 6. Генерация через провайдер с поддержкой Failover по цепочке запасных моделей из реестра
            const modelsToTry = req.isAnonymous
                ? [targetModel]
                : this.registry
                    .getFallbackChain(targetModel.id)
                    .filter((m, index) => index === 0 || this.isAllowedFallback(m, effectivePlan, economyState));
            let success = false;
            let streamedResponse = null;
            let usedModel = targetModel;
            let firstTokenMs = null;
            // Шаблонные ответы-заглушки разрешены только вне production. В production любая из этих
            // настроек не может подменить реальную модель выдуманным ответом.
            const isTestEnv = !isProduction &&
                (this.useMockEngine ??
                    (process.env.NODE_ENV === 'test' ||
                        this.aiConfig.failureRate > 0 ||
                        (this.aiConfig.thinkingMs[0] === 0 &&
                            this.aiConfig.thinkingMs[1] === 0 &&
                            this.aiConfig.chunkMs[0] === 0 &&
                            this.aiConfig.chunkMs[1] === 0)));
            let usedEngineId;
            let watchdogTimedOut = false;
            // Общая оценка пользователей по лёгким моделям: при частых дизлайках глубина размышлений
            // простых запросов поднимается на шаг.
            const escalate = this.feedbackStore.shouldEscalateFromLightModel(targetModel.id, taskInfo.level);
            if (!isTestEnv) {
                for (const candidateModel of modelsToTry) {
                    if (combinedIsCancelled())
                        break;
                    const provider = this.providers.get(candidateModel.provider);
                    if (!provider || !provider.isAvailable()) {
                        continue;
                    }
                    const engineId = candidateModel.providerModelId;
                    // Предохранитель ведётся по паре «провайдер + движок»: отказ одной модели не отключает
                    // остальные модели того же ключа OpenRouter.
                    const breakerKey = `${provider.type}:${engineId}`;
                    if (this.circuitBreaker.isOpen(breakerKey)) {
                        console.warn(`[ai-gateway] Circuit breaker OPEN для ${breakerKey}, быстрый переход к следующему fallback`);
                        continue;
                    }
                    // Глубина размышлений и потолок ответа считаются под конкретную модель цепочки:
                    // у каждой свой набор допустимых значений и своя цена выходных токенов.
                    const wantedEffort = chooseReasoningEffort({
                        level: taskInfo.level,
                        category: taskInfo.category,
                        plan: effectivePlan,
                        stage,
                        costClass: candidateModel.costClass,
                        escalate,
                    });
                    const reasoning = toProviderReasoning(candidateModel.reasoning, wantedEffort);
                    const maxTokens = computeOutputCap({
                        planMaxTokens: entitlements.maxTokens,
                        modelMaxOutputTokens: candidateModel.maxOutputTokens,
                        stage,
                        level: taskInfo.level,
                        heavyContext: hasWorkspaceOrAttachments,
                    });
                    const runPass = (withReasoning) => this.streamWithWatchdog(provider, {
                        model: engineId,
                        messages: optimizedMessages,
                        maxTokens,
                        reasoning: withReasoning,
                    }, {
                        onDelta: (delta) => {
                            if (firstTokenMs === null) {
                                firstTokenMs = Date.now() - startTime;
                            }
                            callbacks.onDelta(delta);
                        },
                        isCancelled: combinedIsCancelled,
                        clientSignal: clientAbortController.signal,
                        providerTimeoutMs: req.providerTimeoutMs,
                    });
                    try {
                        usedModel = candidateModel;
                        usedEngineId = engineId;
                        let pass;
                        try {
                            pass = await runPass(reasoning);
                        }
                        catch (firstError) {
                            // HTTP 400 при заданных размышлениях почти всегда значит, что модель не принимает
                            // это значение параметра. Один повтор без параметра сохраняет ответ; предупреждение
                            // в логе подскажет поправить таблицу размышлений модели в реестре.
                            if (reasoning && firstError instanceof OpenRouterError && firstError.status === 400) {
                                console.warn(`[ai-gateway] ${engineId} отклонил reasoning=${JSON.stringify(reasoning)}, повтор без параметра`);
                                pass = await runPass(undefined);
                            }
                            else {
                                throw firstError;
                            }
                        }
                        streamedResponse = pass.response;
                        watchdogTimedOut = pass.timedOut;
                        if (streamedResponse && streamedResponse.content.length > 0) {
                            if (pass.timedOut) {
                                // Ответ дошёл частично и оборвался по таймауту: пользователю он показан, но
                                // провайдер считается нестабильным.
                                this.circuitBreaker.recordFailure(breakerKey, new Error('Stream stalled'));
                            }
                            else {
                                this.circuitBreaker.recordSuccess(breakerKey);
                            }
                            this.noteEngineMismatch(engineId, streamedResponse.model);
                            success = true;
                            break;
                        }
                        else if (!pass.timedOut && combinedIsCancelled()) {
                            break;
                        }
                        else {
                            this.circuitBreaker.recordFailure(breakerKey, new Error('Empty response from provider'));
                        }
                    }
                    catch (providerError) {
                        // 401 и 402 относятся к ключу и балансу OpenRouter, а не к модели: все остальные модели
                        // того же ключа упадут так же. Не жжём предохранитель каждой модели и не гоняем цепочку.
                        if (providerError instanceof OpenRouterError &&
                            (providerError.status === 401 || providerError.status === 402)) {
                            console.error(`[ai-gateway] Ключ OpenRouter не принят или баланс исчерпан (HTTP ${providerError.status}): все модели недоступны`);
                            break;
                        }
                        this.circuitBreaker.recordFailure(breakerKey, providerError);
                        console.warn(`[ai-gateway] Провайдер ${provider.type} (модель ${candidateModel.name}) вернул ошибку:`, providerError);
                    }
                }
            }
            let fallbackContent = '';
            let responseSource = 'provider';
            if (!success && !isCancelled()) {
                if (!isTestEnv) {
                    // Если все модели цепочки упали в проде — честная ошибка, лимиты не списываем
                    callbacks.onError({
                        code: 'provider_error',
                        message: ERROR_MESSAGES[language],
                    });
                    this.usageStore.recordUsage({
                        userId: activeUserId,
                        conversationId: req.conversationId,
                        modelId: targetModel.id,
                        provider: targetModel.provider,
                        inputTokens: 0,
                        outputTokens: 0,
                        estimatedCost: 0,
                        latencyMs: Date.now() - startTime,
                        status: 'error',
                        source: 'provider',
                    });
                    return;
                }
                // В test / dev режиме используем шаблонный генератор
                responseSource = 'template';
                const templateAnswer = pickAnswer(prompt, language, this.aiConfig.random, targetModel.name, activeAttachments ?? req.attachments, (activeWorkspace ?? req.workspaceContext));
                await streamText(templateAnswer, {
                    thinkingMs: this.aiConfig.thinkingMs,
                    chunkMs: this.aiConfig.chunkMs,
                    random: this.aiConfig.random,
                    isCancelled,
                    onDelta: (delta) => {
                        if (firstTokenMs === null) {
                            firstTokenMs = Date.now() - startTime;
                        }
                        fallbackContent += delta;
                        callbacks.onDelta(delta);
                    },
                });
                streamedResponse = {
                    content: fallbackContent,
                    usage: {
                        inputTokens: ContextOptimizer.estimateTokens(prompt),
                        outputTokens: ContextOptimizer.estimateTokens(fallbackContent),
                    },
                    finishReason: isCancelled() ? 'cancelled' : 'stop',
                };
                success = true;
            }
            // 7. Подсчёт токенов, стоимости и запись в UsageStore
            const latencyMs = Date.now() - startTime;
            const inputTokens = streamedResponse?.usage.inputTokens ?? ContextOptimizer.estimateTokens(prompt);
            const outputTokens = streamedResponse?.usage.outputTokens ??
                ContextOptimizer.estimateTokens(streamedResponse?.content ?? '');
            // Цена приоритетно берётся из ответа провайдера (usage.cost): она включает размышления,
            // кэш и фактический тариф. Таблица реестра — запасной вариант.
            const requestCost = computeRequestCost({
                model: usedModel,
                engineId: usedEngineId,
                tokens: {
                    inputTokens,
                    outputTokens,
                    cachedTokens: streamedResponse?.usage.cachedTokens,
                    reasoningTokens: streamedResponse?.usage.reasoningTokens,
                },
                providerCost: responseSource === 'provider' ? streamedResponse?.cost : undefined,
            });
            const totalEstimatedCost = Number(requestCost.usd.toFixed(6));
            // Остановка сторожем по таймауту — это обрыв, а не выбор пользователя: ответ можно продолжить.
            let finishReason = streamedResponse?.finishReason ?? (isCancelled() ? 'cancelled' : 'stop');
            if (watchdogTimedOut && !isCancelled() && finishReason !== 'stop') {
                finishReason = 'length';
            }
            const canContinue = finishReason === 'length';
            this.usageStore.recordUsage({
                userId: activeUserId,
                conversationId: req.conversationId,
                modelId: usedModel.id,
                provider: usedModel.provider,
                inputTokens,
                outputTokens,
                cachedTokens: streamedResponse?.usage.cachedTokens,
                reasoningTokens: streamedResponse?.usage.reasoningTokens,
                estimatedCost: totalEstimatedCost,
                actualCost: typeof streamedResponse?.cost === 'number' ? Number(streamedResponse.cost.toFixed(6)) : null,
                latencyMs,
                ttftMs: firstTokenMs,
                status: isCancelled() ? 'cancelled' : 'success',
                source: responseSource,
            });
            if (!isCancelled()) {
                if (streamedResponse?.content && cacheable && finishReason === 'stop') {
                    semanticCache.set(targetModel.id, language, prompt, streamedResponse.content, {
                        inputTokens,
                        outputTokens,
                    }, {
                        userScope,
                        historyHash,
                        source: responseSource,
                        finishReason,
                        hasAttachments: !cacheable,
                    });
                }
                callbacks.onDone({
                    inputTokens,
                    outputTokens,
                    selectedModel: { id: usedModel.id, name: usedModel.name },
                    routingReason: usedModel.id !== targetModel.id
                        ? `${routingReason}; fallback to ${usedModel.name}`
                        : routingReason,
                    source: responseSource,
                    finishReason,
                    canContinue,
                    contextSummary: generatedSummary,
                });
            }
        }
        catch (error) {
            console.error('[ai-gateway] Критическая ошибка генерации:', error);
            callbacks.onError({
                code: 'internal_error',
                message: ERROR_MESSAGES[language],
            });
        }
        finally {
            releaseSlot();
        }
    }
}
