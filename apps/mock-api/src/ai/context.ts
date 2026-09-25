/**
 * Context Optimizer — оптимизация и сжатие контекста диалога.
 *
 * Предотвращает переполнение контекстного окна модели, усекает историю
 * по скользящему окну и сжимает длинные сообщения.
 */

import type { IncomingMessage, Language } from '../types.js';
import type { ProviderMessage } from './gateway-types.js';

export interface ContextOptimizationOptions {
  maxMessages: number;
  maxTokens?: number;
  systemPrompt?: string;
  language?: Language;
}

export class ContextOptimizer {
  /**
   * Оценка количества токенов (эвристика 4 символа на токен).
   */
  static estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }

  /**
   * Подготовить и оптимизировать историю сообщений для отправки в модель.
   */
  static optimize(
    messages: IncomingMessage[],
    options: ContextOptimizationOptions,
  ): ProviderMessage[] {
    const result: ProviderMessage[] = [];

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
    let currentTokens = result.reduce(
      (sum, m) => sum + this.estimateTokens(m.content),
      0,
    );
    const maxTokens = options.maxTokens ?? 32000;

    const chosenMessages: IncomingMessage[] = [];

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

    // 4. Формируем итоговый список сообщений
    for (const msg of chosenMessages) {
      result.push({
        role: msg.role,
        content: msg.content.trim(),
      });
    }

    return result;
  }
}
