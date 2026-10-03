/**
 * Semantic & Query Cache для AI Gateway.
 *
 * Phase 0: добавлен source field в UsageRecord.
 * Phase 1:
 *   - Ключ кэша включает хэш последних 2–3 сообщений истории (изолирует «продолжи» в разных чатах).
 *   - Платные тарифы получают пользовательский кэш (scope = userId), free — общий (scope = 'shared').
 *   - Не кэшируем: шаблонные ответы (source === 'template'), обрывы (finishReason === 'length'),
 *     запросы с вложениями.
 */

import type { ResponseSource } from './gateway-types.js';

export interface CacheEntry {
  key: string;
  normalizedQuery: string;
  response: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: number;
  hits: number;
}

export class SemanticCache {
  private cache = new Map<string, CacheEntry>();
  private maxEntries: number;
  private ttlMs: number;

  constructor(maxEntries = 5000, ttlMs = 24 * 60 * 60 * 1000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  /**
   * Нормализовать текст запроса для поиска эквивалентных формулировок.
   */
  static normalize(text: string): string {
    return text
      .trim()
      .toLowerCase()
      .replace(/[\s\t\r\n]+/g, ' ')
      .replace(/[?!.,;:]+$/g, '');
  }

  /**
   * Вычислить хэш последних N сообщений истории (djb2).
   * Позволяет отличить «продолжи» в чате A от «продолжи» в чате B.
   */
  static computeHistoryHash(history: Array<{ role: string; content: string }>, n = 3): string {
    const tail = history.slice(-n);
    const raw = tail.map((m) => `${m.role}:${m.content.slice(0, 120)}`).join('|');
    let hash = 5381;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
  }

  /**
   * Сформировать ключ кэша.
   *
   * Для paid-тарифов userScope = userId (изолированный кэш).
   * Для free-тарифа userScope = 'shared' (общий пул).
   */
  makeKey(
    modelId: string,
    language: string,
    prompt: string,
    userScope: string,
    historyHash: string,
  ): string {
    const norm = SemanticCache.normalize(prompt);
    return `${userScope}:${modelId}:${language}:${historyHash}:${norm}`;
  }

  /**
   * Найти кэшированный ответ.
   */
  get(
    modelId: string,
    language: string,
    prompt: string,
    userScope: string,
    historyHash: string,
  ): CacheEntry | null {
    // Не кэшируем слишком короткие запросы (< 4 символов)
    if (prompt.trim().length < 4) return null;

    const key = this.makeKey(modelId, language, prompt, userScope, historyHash);
    const entry = this.cache.get(key);

    if (!entry) return null;

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
   *
   * Не сохраняем:
   *   - шаблонные ответы (source === 'template')
   *   - обрезанные ответы (finishReason === 'length')
   *   - запросы с вложениями (hasAttachments === true)
   */
  set(
    modelId: string,
    language: string,
    prompt: string,
    response: string,
    usage: { inputTokens: number; outputTokens: number },
    options: {
      userScope: string;
      historyHash: string;
      source: ResponseSource;
      finishReason?: string;
      hasAttachments?: boolean;
    },
  ): void {
    if (prompt.trim().length < 4 || response.trim().length < 10) return;

    // Phase 1: фильтры — не кэшировать шаблоны, обрывы и вложения
    if (options.source === 'template') return;
    if (options.finishReason === 'length') return;
    if (options.hasAttachments) return;

    // LRU очистка при переполнении
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    const key = this.makeKey(modelId, language, prompt, options.userScope, options.historyHash);
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
  clear(): void {
    this.cache.clear();
  }

  /**
   * Статистика кэша.
   */
  getStats(): { size: number; totalHits: number } {
    let totalHits = 0;
    for (const entry of this.cache.values()) {
      totalHits += entry.hits;
    }
    return { size: this.cache.size, totalHits };
  }
}

export const semanticCache = new SemanticCache();
