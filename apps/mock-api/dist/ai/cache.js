/**
 * Semantic & Query Cache для AI Gateway.
 *
 * Кэширует ответы на частые и повторяющиеся запросы, обеспечивая
 * мгновенный отклик (<50мс) и нулевую себестоимость для кэшированных запросов.
 */
export class SemanticCache {
    cache = new Map();
    maxEntries;
    ttlMs;
    constructor(maxEntries = 5000, ttlMs = 24 * 60 * 60 * 1000) {
        this.maxEntries = maxEntries;
        this.ttlMs = ttlMs;
    }
    /**
     * Нормализовать текст запроса для поиска эквивалентных формулировок.
     */
    static normalize(text) {
        return text
            .trim()
            .toLowerCase()
            .replace(/[\s\t\r\n]+/g, ' ')
            .replace(/[?!.,;:]+$/g, '');
    }
    /**
     * Сформировать ключ кэша на основе модели, языка и нормализованного промпта.
     */
    makeKey(modelId, language, prompt) {
        const norm = SemanticCache.normalize(prompt);
        return `${modelId}:${language}:${norm}`;
    }
    /**
     * Найти кэшированный ответ.
     */
    get(modelId, language, prompt) {
        // Не кэшируем слишком короткие запросы (< 4 символов)
        if (prompt.trim().length < 4)
            return null;
        const key = this.makeKey(modelId, language, prompt);
        const entry = this.cache.get(key);
        if (!entry)
            return null;
        // Проверка срока жизни (TTL)
        if (Date.now() - entry.createdAt > this.ttlMs) {
            this.cache.delete(key);
            return null;
        }
        entry.hits++;
        return entry;
    }
    /**
     * Сохранить ответ в кэш.
     */
    set(modelId, language, prompt, response, usage) {
        if (prompt.trim().length < 4 || response.trim().length < 10)
            return;
        // LRU очистка при переполнении
        if (this.cache.size >= this.maxEntries) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey)
                this.cache.delete(oldestKey);
        }
        const key = this.makeKey(modelId, language, prompt);
        this.cache.set(key, {
            key,
            normalizedQuery: SemanticCache.normalize(prompt),
            response,
            modelId,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            createdAt: Date.now(),
            hits: 0,
        });
    }
    /**
     * Очистить кэш.
     */
    clear() {
        this.cache.clear();
    }
    /**
     * Статистика кэша.
     */
    getStats() {
        let totalHits = 0;
        for (const entry of this.cache.values()) {
            totalHits += entry.hits;
        }
        return { size: this.cache.size, totalHits };
    }
}
export const semanticCache = new SemanticCache();
