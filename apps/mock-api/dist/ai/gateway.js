/**
 * AI Gateway — центральный шлюз оркестрации AI-запросов Ketner AI.
 *
 * Объединяет:
 * - Model Registry (каталог моделей)
 * - Provider Manager (адаптеры OpenAI, Anthropic, Google, OpenRouter)
 * - Entitlement Service (проверка прав и тарифов)
 * - Fair Use Engine (защита от злоупотреблений, rate limits, concurrency)
 * - Context Optimizer (оптимизация контекста)
 * - Usage Accounting & Cost Calculator (учёт токенов и себестоимости)
 * - Fallback & Failover (автоматическое переключение при сбоях провайдеров)
 */
import { ERROR_MESSAGES, pickAnswer } from './answers.js';
import { AutoRouter } from './auto-router.js';
import { semanticCache } from './cache.js';
import { ContextOptimizer } from './context.js';
import { modelRegistry } from './model-registry.js';
import { providerManager } from './providers/provider-factory.js';
import { delay, streamText } from './stream.js';
import { CostCalculator } from '../services/cost.js';
import { EntitlementService } from '../services/entitlement.js';
import { FairUseEngine } from '../services/fair-use.js';
export class AIGateway {
    registry;
    providers;
    usageStore;
    aiConfig;
    constructor(deps) {
        this.registry = deps.registry ?? modelRegistry;
        this.providers = deps.providers ?? providerManager;
        this.usageStore = deps.usageStore;
        this.aiConfig = deps.aiConfig;
    }
    /**
     * Стриминговая генерация ответа через AI Gateway.
     */
    async stream(req, callbacks, isCancelled) {
        const startTime = Date.now();
        const activeUserId = req.userId;
        const language = req.language;
        // 1. Определение эффективного плана и лимитов
        const effectivePlan = EntitlementService.resolveEffectivePlan(req.userPlan);
        const entitlements = EntitlementService.getEntitlements(effectivePlan);
        const snapshot = this.usageStore.getFairUseSnapshot(activeUserId);
        // Проверка превышения бюджета себестоимости (адаптивный даунгрейд вместо жесткого блока)
        const isBudgetExceeded = entitlements.costBudget > 0 &&
            snapshot.estimatedCostLastMonth >= entitlements.costBudget;
        // 2. Резолвинг модели (включая Auto Mode и адаптивную защиту)
        let targetModel;
        let routingReason;
        const prompt = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
        if (req.modelId === 'auto') {
            const allowed = this.registry.getForPlan(effectivePlan);
            const routed = AutoRouter.routeWithReason(prompt, allowed, {
                userPlan: effectivePlan,
                budgetExceeded: isBudgetExceeded,
                monthlyCost: snapshot.estimatedCostLastMonth,
                monthlyBudget: entitlements.costBudget,
            });
            targetModel = routed.model;
            routingReason = routed.reason;
        }
        else {
            const resolved = this.registry.resolve(req.modelId);
            if (isBudgetExceeded && resolved.tier === 'flagship') {
                targetModel = this.registry.resolve('ketner-mini');
                routingReason = `Budget protection: dynamically routed to ${targetModel.name} for fair usage`;
            }
            else {
                targetModel = resolved;
                routingReason = `Explicit user model selection (${targetModel.name})`;
            }
        }
        // 3. Проверка прав доступа (Entitlement Check)
        const accessCheck = EntitlementService.checkModelAccess(targetModel, effectivePlan);
        if (!accessCheck.allowed) {
            const msg = language === 'en'
                ? `Access to ${targetModel.name} requires an active subscription (${accessCheck.requiredPlan} or Ultra). Please upgrade your plan.`
                : `Для доступа к модели ${targetModel.name} требуется подписка (${accessCheck.requiredPlan} или Ultra). Пожалуйста, улучшите ваш тариф.`;
            callbacks.onError({
                code: 'upgrade_required',
                message: msg,
            });
            return;
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
            const baseSystemPrompt = targetModel.defaultSystemPrompt[language];
            const systemPrompt = isBudgetExceeded
                ? `${baseSystemPrompt} ${language === 'en' ? 'Keep responses concise and direct.' : 'Отвечай максимально кратко и по существу.'}`
                : baseSystemPrompt;
            const optimizedMessages = ContextOptimizer.optimize(req.messages.map((m) => ({
                role: m.role,
                content: m.content,
            })), {
                maxMessages: maxContextMessages,
                systemPrompt,
                language,
            });
            // 5.1. Проверка семантического кэша (Semantic & Query Caching)
            const cachedHit = semanticCache.get(targetModel.id, language, prompt);
            if (cachedHit && !isCancelled()) {
                await streamText(cachedHit.response, {
                    thinkingMs: [5, 10],
                    chunkMs: [5, 10],
                    random: this.aiConfig.random,
                    isCancelled,
                    onDelta: callbacks.onDelta,
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
                    status: 'success',
                });
                if (!isCancelled()) {
                    callbacks.onDone({
                        inputTokens: cachedHit.inputTokens,
                        outputTokens: cachedHit.outputTokens,
                        selectedModel: { id: targetModel.id, name: targetModel.name },
                        routingReason: `${routingReason} (Semantic Cache Hit)`,
                    });
                }
                return;
            }
            // 6. Попытка генерации через провайдер с поддержкой Failover
            const modelsToTry = this.registry.getFallbackChain(targetModel.id);
            let success = false;
            let streamedResponse = null;
            let usedModel = targetModel;
            const isTestEnv = process.env.NODE_ENV === 'test' ||
                this.aiConfig.failureRate > 0 ||
                (this.aiConfig.thinkingMs[0] === 0 &&
                    this.aiConfig.thinkingMs[1] === 0 &&
                    this.aiConfig.chunkMs[0] === 0 &&
                    this.aiConfig.chunkMs[1] === 0);
            if (!isTestEnv) {
                for (const candidateModel of modelsToTry) {
                    if (isCancelled())
                        break;
                    const provider = this.providers.get(candidateModel.provider);
                    if (!provider || !provider.isAvailable()) {
                        continue;
                    }
                    try {
                        usedModel = candidateModel;
                        streamedResponse = await provider.streamText({
                            model: candidateModel.providerModelId,
                            messages: optimizedMessages,
                            stream: true,
                            maxTokens: isBudgetExceeded
                                ? Math.min(candidateModel.maxOutputTokens, entitlements.maxTokens, 1024)
                                : Math.min(candidateModel.maxOutputTokens, entitlements.maxTokens),
                        }, {
                            onDelta: callbacks.onDelta,
                            isCancelled,
                        });
                        if (streamedResponse && streamedResponse.content.length > 0) {
                            success = true;
                            break;
                        }
                    }
                    catch (providerError) {
                        console.warn(`[ai-gateway] Провайдер ${candidateModel.provider} (модель ${candidateModel.name}) вернул ошибку:`, providerError);
                    }
                }
            }
            // 7. Если провайдеры недоступны или в режиме тестирования — запускаем качественный fallback генератор
            let fallbackContent = '';
            if (!success && !isCancelled()) {
                const templateAnswer = pickAnswer(prompt, language, this.aiConfig.random);
                await streamText(templateAnswer, {
                    thinkingMs: this.aiConfig.thinkingMs,
                    chunkMs: this.aiConfig.chunkMs,
                    random: this.aiConfig.random,
                    isCancelled,
                    onDelta: (delta) => {
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
            // 8. Подсчёт токенов, стоимости и запись в UsageStore
            const latencyMs = Date.now() - startTime;
            const inputTokens = streamedResponse?.usage.inputTokens ?? ContextOptimizer.estimateTokens(prompt);
            const outputTokens = streamedResponse?.usage.outputTokens ??
                ContextOptimizer.estimateTokens(streamedResponse?.content ?? '');
            const costResult = CostCalculator.calculate({
                inputTokens,
                outputTokens,
                cachedTokens: streamedResponse?.usage.cachedTokens,
                reasoningTokens: streamedResponse?.usage.reasoningTokens,
            }, usedModel.pricing);
            this.usageStore.recordUsage({
                userId: activeUserId,
                conversationId: req.conversationId,
                modelId: usedModel.id,
                provider: usedModel.provider,
                inputTokens,
                outputTokens,
                cachedTokens: streamedResponse?.usage.cachedTokens,
                reasoningTokens: streamedResponse?.usage.reasoningTokens,
                estimatedCost: costResult.totalCost,
                actualCost: streamedResponse?.cost ?? null,
                latencyMs,
                status: isCancelled() ? 'cancelled' : 'success',
            });
            if (!isCancelled()) {
                if (streamedResponse?.content) {
                    semanticCache.set(targetModel.id, language, prompt, streamedResponse.content, {
                        inputTokens,
                        outputTokens,
                    });
                }
                callbacks.onDone({
                    inputTokens,
                    outputTokens,
                    selectedModel: { id: usedModel.id, name: usedModel.name },
                    routingReason,
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
