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

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ResponseSource } from './gateway-types.js';

/**
 * Семантический кэш ответов ВЫКЛЮЧЕН (решение владельца, 14.11.2026): шлюз его не читает и не пишет.
 * Переключателя в окружении нет намеренно — включение только правкой кода и ревью. До включения
 * нужно исправить:
 *   1. ключ должен покрывать всё, что уходит модели: системный промпт, сводку и всё окно истории
 *      (сейчас — последние 3 сообщения по 120 символов);
 *   2. кэш только свой у каждого пользователя (сейчас бесплатные тарифы делят общий пул `shared`);
 *   3. никакого файла с открытым текстом на диске (и без синхронной перезаписи на каждый ответ);
 *   4. удаление записей вместе с диалогом и аккаунтом;
 *   5. попадание в кэш не расходует квоту токенов fair-use;
 *   6. изоляция в тестах (без общего состояния между прогонами).
 */
export const SEMANTIC_CACHE_ENABLED = false;

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
  private storagePath?: string;

  constructor(maxEntries = 5000, ttlMs = 24 * 60 * 60 * 1000, storagePath?: string) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.storagePath = storagePath;
    if (this.storagePath) {
      this.load();
    }
  }

  /**
   * Phase 3: Загрузка кэша с диска при старте сервера с отсечением просроченных записей по TTL.
   */
  load(): void {
    if (!this.storagePath || !existsSync(this.storagePath)) return;
    try {
      const raw = readFileSync(this.storagePath, 'utf-8');
      const data = JSON.parse(raw) as CacheEntry[];
      const now = Date.now();
      if (Array.isArray(data)) {
        for (const entry of data) {
          if (entry.key && now - entry.createdAt <= this.ttlMs) {
            this.cache.set(entry.key, entry);
          }
        }
      }
    } catch (err) {
      console.warn('[semantic-cache] Ошибка загрузки персистентного кэша:', err);
    }
  }

  /**
   * Phase 3: Сохранение кэша на диск для переживания рестартов контейнера.
   */
  persist(): void {
    if (!this.storagePath) return;
    try {
      const dir = dirname(this.storagePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const tmpPath = `${this.storagePath}.tmp`;
      const entries = Array.from(this.cache.values());
      writeFileSync(tmpPath, JSON.stringify(entries, null, 2), 'utf-8');
      renameSync(tmpPath, this.storagePath);
    } catch (err) {
      console.warn('[semantic-cache] Ошибка сохранения персистентного кэша:', err);
    }
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

    this.persist();
  }

  /**
   * Очистить кэш.
   */
  clear(): void {
    this.cache.clear();
    if (this.storagePath && existsSync(this.storagePath)) {
      try {
        unlinkSync(this.storagePath);
      } catch {
        // ignore
      }
    }
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

/** Экземпляр шлюза: только в памяти, без файла на диске (и не используется, пока кэш выключен). */
export const semanticCache = new SemanticCache(5000, 24 * 60 * 60 * 1000);

/** Где прежний экземпляр хранил кэш (путь от рабочего каталога процесса). */
export const LEGACY_SEMANTIC_CACHE_FILE = 'data/semantic-cache.json';

/**
 * Удаляет файл прежнего кэша и его временную копию, если они остались: в них открытым текстом
 * лежали вопросы и ответы пользователей. Вызывается при старте сервера. Возвращает удалённые пути.
 */
export function removeLegacySemanticCacheFile(
  path = resolve(process.env.SEMANTIC_CACHE_PATH ?? LEGACY_SEMANTIC_CACHE_FILE),
): string[] {
  const removed: string[] = [];
  for (const file of [path, `${path}.tmp`]) {
    try {
      if (existsSync(file)) {
        unlinkSync(file);
        removed.push(file);
      }
    } catch (error) {
      console.warn('[semantic-cache] Не удалось удалить файл прежнего кэша:', error);
    }
  }
  if (removed.length > 0) {
    console.log(`[semantic-cache] Удалён файл прежнего кэша ответов (${removed.length})`);
  }
  return removed;
}
