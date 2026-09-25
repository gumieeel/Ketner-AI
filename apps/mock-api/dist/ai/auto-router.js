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
        const isComplex = prompt.length > 1500 || (isCode && prompt.length > 500) || isReasoning;
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
    static routeWithReason(prompt, availableModels) {
        if (availableModels.length === 0) {
            throw new Error('No models available for routing');
        }
        if (availableModels.length === 1) {
            return {
                model: availableModels[0],
                reason: `Default plan model (${availableModels[0].name})`,
            };
        }
        const classification = this.classify(prompt);
        // Cost-aware routing:
        // Если задача простая, короткая или общая разговорная (например, приветствие или короткий вопрос),
        // отдаём предпочтение легкой/быстрой модели для снижения затрат на токены и низкой задержки.
        const isCasualOrSimple = classification.category === 'general' &&
            classification.complexity === 'simple' &&
            prompt.trim().length < 200;
        if (isCasualOrSimple) {
            const fastModel = availableModels.find((m) => m.tier === 'free' || m.id === 'ketner-mini') ??
                availableModels.find((m) => m.tier === 'standard') ??
                availableModels[0];
            return {
                model: fastModel,
                reason: `Cost-optimized fast routing for casual conversation (${fastModel.name})`,
            };
        }
        // Оцениваем каждую модель на соответствие задаче
        const scored = availableModels.map((model) => {
            let score = 0;
            // Очки за соответствие категории
            if (classification.category === 'coding' && model.capabilities.coding)
                score += 12;
            if (classification.category === 'math' && model.capabilities.math)
                score += 12;
            if (classification.category === 'reasoning' && model.capabilities.reasoning)
                score += 12;
            if (classification.category === 'creative' && model.capabilities.creative)
                score += 10;
            if (classification.category === 'translation' && model.capabilities.translation)
                score += 10;
            // Сложные задачи направляем на flagship / premium модели
            if (classification.complexity === 'complex') {
                if (model.tier === 'flagship')
                    score += 6;
                if (model.tier === 'premium')
                    score += 3;
            }
            else {
                // Для простых задач экономим: +2 очка моделям standard/free
                if (model.tier === 'standard')
                    score += 2;
                if (model.tier === 'free')
                    score += 1;
            }
            // Длинный контекст
            if (classification.requiresLongContext && model.contextWindow >= 100_000) {
                score += 8;
            }
            return { model, score };
        });
        scored.sort((a, b) => b.score - a.score);
        const chosen = scored[0].model;
        // Формируем понятное объяснение выбора
        let reason = `Auto-routed to ${chosen.name}`;
        if (classification.category === 'coding') {
            reason = `Selected ${chosen.name} for code analysis and programming task`;
        }
        else if (classification.category === 'math') {
            reason = `Selected ${chosen.name} for advanced mathematical reasoning`;
        }
        else if (classification.category === 'reasoning') {
            reason = `Selected ${chosen.name} for deep analytical reasoning`;
        }
        else if (classification.category === 'translation') {
            reason = `Selected ${chosen.name} for multilingual translation optimization`;
        }
        else if (classification.category === 'creative') {
            reason = `Selected ${chosen.name} for creative writing and content generation`;
        }
        else if (classification.requiresLongContext) {
            reason = `Selected ${chosen.name} for high-capacity context window`;
        }
        return { model: chosen, reason };
    }
    /**
     * Выбрать наилучшую модель из доступных пользователю.
     */
    static route(prompt, availableModels) {
        return this.routeWithReason(prompt, availableModels).model;
    }
}
