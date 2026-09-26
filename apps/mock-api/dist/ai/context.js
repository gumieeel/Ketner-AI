/**
 * Context Optimizer — оптимизация и сжатие контекста диалога.
 *
 * Предотвращает переполнение контекстного окна модели, усекает историю
 * по скользящему окну и сжимает длинные сообщения.
 */
export class ContextOptimizer {
    /**
     * Оценка количества токенов (эвристика 4 символа на токен).
     */
    static estimateTokens(text) {
        return Math.max(1, Math.ceil(text.length / 4));
    }
    /**
     * Подготовить и оптимизировать историю сообщений для отправки в модель.
     */
    static optimize(messages, options) {
        const result = [];
        // 1. Системный промпт (всегда первый)
        if (options.systemPrompt && options.systemPrompt.trim()) {
            result.push({
                role: 'system',
                content: options.systemPrompt.trim(),
            });
        }
        if (messages.length === 0) {
            return result;
        }
        // 2. Берём скользящее окно последних сообщений
        const maxMsgs = Math.max(1, options.maxMessages);
        const windowed = messages.slice(-maxMsgs);
        // 3. Если задан лимит токенов, обрезаем с начала окна
        let currentTokens = result.reduce((sum, m) => sum + this.estimateTokens(m.content), 0);
        const maxTokens = options.maxTokens ?? 32000;
        const chosenMessages = [];
        // Идём с конца (самые свежие сообщения наиболее важны)
        for (let i = windowed.length - 1; i >= 0; i--) {
            const msg = windowed[i];
            const msgTokens = this.estimateTokens(msg.content);
            if (chosenMessages.length > 0 && currentTokens + msgTokens > maxTokens) {
                // Контекст исчерпан, прекращаем добавление старых сообщений
                break;
            }
            chosenMessages.unshift(msg);
            currentTokens += msgTokens;
        }
        // 4. Формируем итоговый список сообщений с агрессивным сжатием контекста (> 6 сообщений)
        // Длинный контекст = смерть экономики. Модель получает summary + последние сообщения.
        if (chosenMessages.length > 6) {
            const recentCount = 3;
            const toCompress = chosenMessages.slice(0, chosenMessages.length - recentCount);
            const recent = chosenMessages.slice(chosenMessages.length - recentCount);
            const summarySnippets = toCompress
                .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 80).replace(/\s+/g, ' ')}...`)
                .join(' | ');
            const prefix = options.language === 'en'
                ? `[Context summary: ${summarySnippets}]`
                : `[Краткий контекст беседы: ${summarySnippets}]`;
            result.push({
                role: 'system',
                content: prefix,
            });
            for (const msg of recent) {
                result.push({
                    role: msg.role,
                    content: msg.content.trim(),
                });
            }
        }
        else {
            for (const msg of chosenMessages) {
                result.push({
                    role: msg.role,
                    content: msg.content.trim(),
                });
            }
        }
        return result;
    }
    /**
     * Пост-процессинг: обрезка и сжатие избыточного текста для контроля выходных токенов.
     */
    static compressText(text, maxTokens) {
        if (!maxTokens || text.length === 0)
            return text;
        const maxChars = maxTokens * 4;
        if (text.length <= maxChars)
            return text;
        // Обрезаем по последнему законченному предложению
        const sliced = text.slice(0, maxChars);
        const lastPunctuation = Math.max(sliced.lastIndexOf('.'), sliced.lastIndexOf('!'), sliced.lastIndexOf('?'), sliced.lastIndexOf('\n'));
        if (lastPunctuation > maxChars * 0.7) {
            return sliced.slice(0, lastPunctuation + 1).trim();
        }
        return sliced.trim();
    }
}
