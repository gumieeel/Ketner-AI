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
     * Выбрать наилучшую модель из доступных пользователю.
     */
    static route(prompt, availableModels) {
        if (availableModels.length === 0) {
            throw new Error('No models available for routing');
        }
        if (availableModels.length === 1) {
            return availableModels[0];
        }
        const classification = this.classify(prompt);
        // Оцениваем каждую модель на соответствие задаче
        const scored = availableModels.map((model) => {
            let score = 0;
            // Очки за соответствие категории
            if (classification.category === 'coding' && model.capabilities.coding)
                score += 10;
            if (classification.category === 'math' && model.capabilities.math)
                score += 10;
            if (classification.category === 'reasoning' && model.capabilities.reasoning)
                score += 10;
            if (classification.category === 'creative' && model.capabilities.creative)
                score += 8;
            if (classification.category === 'translation' && model.capabilities.translation)
                score += 8;
            // Сложные задачи направляем на flagship / premium модели
            if (classification.complexity === 'complex') {
                if (model.tier === 'flagship')
                    score += 5;
                if (model.tier === 'premium')
                    score += 3;
            }
            // Длинный контекст
            if (classification.requiresLongContext && model.contextWindow >= 100_000) {
                score += 6;
            }
            return { model, score };
        });
        scored.sort((a, b) => b.score - a.score);
        return scored[0].model;
    }
}
