/**
 * Auto Mode Router — интеллектуальная маршрутизация запросов.
 *
 * Анализирует текст запроса пользователя, классифицирует задачу
 * и выбирает наиболее подходящую модель среди доступных пользователю.
 *
 * ВАЖНО: Auto Router используется ТОЛЬКО когда пользователь выбрал 'auto'
 * или не указал модель. Явно выбранная модель НИКОГДА не подменяется.
 */
export class AutoRouter {
    /**
     * Классифицировать задачу по тексту промпта.
     */
    static classify(prompt) {
        const text = prompt.toLowerCase();
        // 1. Кодинг / разработка
        const codeKeywords = [
            'function',
            'const ',
            'let ',
            'var ',
            'class ',
            'import ',
            'export ',
            'def ',
            'return',
            'async',
            'await',
            'interface ',
            'type ',
            'sql',
            'select ',
            'insert ',
            'docker',
            'git ',
            'commit',
            'html',
            'css',
            'javascript',
            'typescript',
            'python',
            'react',
            'vue',
            'баг',
            'ошибка',
            'код',
            'функци',
            'скрипт',
            'рефакторинг',
            'тест',
            'напиши код',
            'исправь',
        ];
        const isCode = codeKeywords.some((kw) => text.includes(kw)) || prompt.includes('```');
        // 2. Математика
        const mathKeywords = [
            'вычисли',
            'посчитай',
            'уравнение',
            'интеграл',
            'производная',
            'формула',
            'calculate',
            'solve',
            'equation',
            'integral',
            'derivative',
            'probability',
            'вероятность',
        ];
        const isMath = mathKeywords.some((kw) => text.includes(kw));
        // 3. Рассуждения / глубокий анализ
        const reasoningKeywords = [
            'почему',
            'сравни',
            'проанализируй',
            'в чём разница',
            'архитектура',
            'преимущества и недостатки',
            'why',
            'compare',
            'analyze',
            'difference between',
            'step by step',
            'пошагово',
        ];
        const isReasoning = reasoningKeywords.some((kw) => text.includes(kw));
        // 4. Перевод
        const translationKeywords = [
            'переведи',
            'перевод',
            'translate',
            'translation',
            'на английский',
            'на русский',
            'to english',
            'to russian',
        ];
        const isTranslation = translationKeywords.some((kw) => text.includes(kw));
        // 5. Креатив / тексты
        const creativeKeywords = [
            'напиши статью',
            'эссе',
            'сочинение',
            'стихотворение',
            'пост',
            'рассказ',
            'write an essay',
            'poem',
            'story',
            'blog post',
        ];
        const isCreative = creativeKeywords.some((kw) => text.includes(kw));
        let category = 'general';
        if (isCode)
            category = 'coding';
        else if (isMath)
            category = 'math';
        else if (isReasoning)
            category = 'reasoning';
        else if (isTranslation)
            category = 'translation';
        else if (isCreative)
            category = 'creative';
        const isComplex = prompt.length > 800 || (isCode && prompt.length > 300) || (isMath && prompt.length > 150) || isReasoning;
        return {
            category,
            complexity: isComplex ? 'complex' : 'simple',
            requiresLongContext: prompt.length > 4000,
            suggestedCapabilities: {
                coding: isCode,
                math: isMath,
                reasoning: isReasoning,
                creative: isCreative,
                translation: isTranslation,
            },
        };
    }
    /**
     * Выбрать наилучшую модель из доступных пользователю с объяснением причины выбора.
     */
    static routeWithReason(prompt, availableModels, options) {
        if (availableModels.length === 0) {
            throw new Error('No models available for routing');
        }
        if (availableModels.length === 1) {
            return {
                model: availableModels[0],
                reason: `Default plan model (${availableModels[0].name})`,
            };
        }
        const isBudgetExceeded = options?.budgetExceeded ?? false;
        const userPlan = options?.userPlan ?? 'free';
        // 1. АДАПТИВНЫЙ ДАУНГРЕЙД ПРИ ПРЕВЫШЕНИИ МЕСЯЧНОГО БЮДЖЕТА
        if (isBudgetExceeded) {
            const cheapModels = availableModels.filter((m) => m.tier === 'free' || m.id === 'ketner-mini' || m.id === 'gpt-4o-mini' || m.id === 'gemini-2.5-flash' || m.id === 'claude-3-haiku');
            const chosen = cheapModels[0] ?? availableModels[0];
            return {
                model: chosen,
                reason: `Adaptive cost control: switched to economical model (${chosen.name})`,
            };
        }
        const classification = this.classify(prompt);
        // 2. ДЛЯ FREE ПЛАНА — ТОЛЬКО ДЕШЁВЫЕ МОДЕЛИ
        if (userPlan === 'free') {
            const cheapModels = availableModels.filter((m) => m.tier === 'free' || !m.isPro);
            const targetPool = cheapModels.length > 0 ? cheapModels : availableModels;
            let chosen = targetPool[0];
            if (classification.category === 'coding') {
                chosen = targetPool.find((m) => m.id === 'ketner-mini' || m.id === 'gpt-4o-mini') ?? targetPool[0];
            }
            else if (classification.category === 'creative' || classification.category === 'translation') {
                chosen = targetPool.find((m) => m.id === 'claude-3-haiku' || m.id === 'gpt-4o-mini') ?? targetPool[0];
            }
            else {
                chosen = targetPool.find((m) => m.id === 'gemini-2.5-flash' || m.id === 'gpt-4o-mini') ?? targetPool[0];
            }
            return {
                model: chosen,
                reason: `Free tier auto-routed to ${chosen.name}`,
            };
        }
        // 3. ДЛЯ PLUS ПЛАНА:
        // Простые и средние задачи -> дешёвые/средние модели (экономия себестоимости).
        // Дорогие флагманы — только для действительно сложных задач.
        if (userPlan === 'plus') {
            if (classification.complexity === 'simple') {
                const midModel = availableModels.find((m) => m.id === 'gpt-4o-mini') ??
                    availableModels.find((m) => m.id === 'gemini-2.5-flash') ??
                    availableModels.find((m) => m.id === 'claude-3-haiku') ??
                    availableModels.find((m) => m.tier === 'free') ??
                    availableModels[0];
                return {
                    model: midModel,
                    reason: `Fast & cost-optimized routing for everyday request (${midModel.name})`,
                };
            }
            // Для сложных задач на тарифе Plus — подключаем флагманы
            let flagshipModel = availableModels.find((m) => m.id === 'gpt-6-astra') ??
                availableModels.find((m) => m.id === 'claude-3.5-sonnet' || m.id === 'claude-fable') ??
                availableModels.find((m) => m.id === 'gemini-2.5-pro' || m.id === 'gemini-pro') ??
                availableModels[0];
            if (classification.category === 'coding') {
                flagshipModel =
                    availableModels.find((m) => m.id === 'claude-3.5-sonnet' || m.id === 'claude-fable') ??
                        availableModels.find((m) => m.id === 'gpt-6-astra') ??
                        flagshipModel;
            }
            else if (classification.category === 'reasoning' || classification.category === 'math') {
                flagshipModel =
                    availableModels.find((m) => m.id === 'gpt-6-astra') ??
                        availableModels.find((m) => m.id === 'gemini-2.5-pro' || m.id === 'gemini-pro') ??
                        flagshipModel;
            }
            return {
                model: flagshipModel,
                reason: `Selected flagship ${flagshipModel.name} for complex task`,
            };
        }
        // 4. ДЛЯ PRO И ULTRA ТАРИФОВ:
        // Флагманы используются с максимальным приоритетом и глубиной
        const isCasualSimple = classification.category === 'general' &&
            classification.complexity === 'simple' &&
            prompt.trim().length < 150;
        if (isCasualSimple) {
            const fastModel = availableModels.find((m) => m.id === 'gpt-4o-mini') ??
                availableModels.find((m) => m.id === 'gemini-2.5-flash') ??
                availableModels[0];
            return {
                model: fastModel,
                reason: `Ultra-fast instant response for quick inquiry (${fastModel.name})`,
            };
        }
        let topModel = availableModels.find((m) => m.id === 'gpt-6-astra') ??
            availableModels.find((m) => m.id === 'claude-3.5-sonnet' || m.id === 'claude-fable') ??
            availableModels.find((m) => m.id === 'gemini-2.5-pro' || m.id === 'gemini-pro') ??
            availableModels[0];
        if (classification.category === 'coding') {
            topModel =
                availableModels.find((m) => m.id === 'claude-3.5-sonnet' || m.id === 'claude-fable') ??
                    availableModels.find((m) => m.id === 'gpt-6-astra') ??
                    topModel;
        }
        else if (classification.category === 'reasoning' || classification.category === 'math') {
            topModel =
                availableModels.find((m) => m.id === 'gpt-6-astra') ??
                    availableModels.find((m) => m.id === 'gemini-2.5-pro' || m.id === 'gemini-pro') ??
                    topModel;
        }
        return {
            model: topModel,
            reason: `Flagship routing via ${topModel.name} for ${userPlan.toUpperCase()} subscriber`,
        };
    }
    /**
     * Выбрать наилучшую модель из доступных пользователю.
     */
    static route(prompt, availableModels, options) {
        return this.routeWithReason(prompt, availableModels, options).model;
    }
}
