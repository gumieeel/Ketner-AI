/**
 * Context Optimizer — оптимизация и сжатие контекста диалога.
 *
 * Phase 2 изменения:
 *   - Новая схема: system + первое сообщение + сводка старых сообщений + последние 6–8 сообщений.
 *   - Сводка сохраняется в БД (existingSummary передаётся снаружи), чтобы prefix не менялся.
 *   - Улучшенная токенизация кириллицы: ~2.5–3 символа на токен вместо 4.
 *   - Лимит токенов берётся из contextWindow модели (передаётся через maxTokens).
 *   - finishReason === 'length' → не кэшировать, показать кнопку «Продолжить».
 */

import type { IncomingMessage, Language } from '../types.js';
import type { ProviderMessage } from './gateway-types.js';

export interface ContextOptimizationOptions {
  maxMessages: number;
  maxTokens?: number;
  systemPrompt?: string;
  language?: Language;
  /**
   * Phase 2: ранее сохранённая сводка контекста (из БД).
   * Если передана — используется вместо перегенерации, обеспечивая стабильный prefix.
   */
  existingSummary?: string;
  /**
   * Phase 2: callback для сохранения новой сводки в БД после её генерации.
   * Вызывается только если сводка была сгенерирована (не передана через existingSummary).
   */
  onSummaryGenerated?: (summary: string) => void;
}

export class ContextOptimizer {
  /**
   * Phase 2: улучшенная оценка токенов.
   *
   * Кириллица занимает ~2.5–3 символа на токен (GPT-4 tokenizer).
   * Латиница — ~4 символа на токен.
   * Используем взвешенный коэффициент: если >40% символов кириллица → 2.5 символа/токен.
   */
  static estimateTokens(text: string): number {
    if (!text) return 0;
    const cyrillicCount = (text.match(/[а-яА-ЯёЁ]/g) ?? []).length;
    const cyrillicRatio = cyrillicCount / Math.max(text.length, 1);
    const charsPerToken = cyrillicRatio > 0.4 ? 2.5 : 4;
    return Math.max(1, Math.ceil(text.length / charsPerToken));
  }

  /**
   * Нормализация текста для экономии токенов, безопасная для кода.
   *
   * Раньше убирались ВСЕ отступы и повторные пробелы, поэтому модель видела Python/YAML/Makefile
   * без структуры, а `replace.targetContent` не совпадал с реальным файлом. Теперь:
   *  - внутри ограждений ``` (в том числе незакрытых) текст не меняется, кроме перевода строк
   *    и пробелов в конце строк;
   *  - в обычном тексте блоки из двух и более подряд идущих строк с отступом (вставленный
   *    без ограждения код) сохраняются как есть;
   *  - остальной текст чистится как раньше: лишние пробелы и пустые строки убираются.
   */
  static cleanText(text: string): string {
    if (!text) return '';
    const normalized = text.replace(/\r\n/g, '\n');
    const parts = normalized.split(/(```[\s\S]*?(?:```|$))/g);
    const cleaned = parts
      .map((part, index) =>
        index % 2 === 1 ? part.replace(/[ \t]+$/gm, '') : this.cleanProse(part),
      )
      .join('');
    return cleaned.replace(/^\n+/, '').replace(/\s+$/, '');
  }

  private static cleanProse(text: string): string {
    if (!text) return '';
    const lines = text.split('\n');
    const isIndented = (line: string): boolean => /^( {2,}|\t)\S/.test(line);
    const keep = new Array<boolean>(lines.length).fill(false);

    // Серии строк с отступом (допускается одна пустая строка между ними) считаются кодом.
    let i = 0;
    while (i < lines.length) {
      if (!isIndented(lines[i])) {
        i++;
        continue;
      }
      let end = i;
      let count = 0;
      let j = i;
      while (j < lines.length) {
        if (isIndented(lines[j])) {
          count++;
          end = j;
          j++;
        } else if (lines[j].trim() === '' && j + 1 < lines.length && isIndented(lines[j + 1])) {
          j++;
        } else {
          break;
        }
      }
      if (count >= 2) {
        for (let k = i; k <= end; k++) keep[k] = true;
      }
      i = end + 1;
    }

    return lines
      .map((line, index) =>
        keep[index] ? line.replace(/[ \t]+$/, '') : line.trim().replace(/[ \t]+/g, ' '),
      )
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
  }

  /**
   * Удаление внутренних рассуждений (<think>...</think>) из истории ответов ассистента.
   * Модели провайдеров (OpenRouter, DeepSeek и др.) отклоняют или ломаются при получении
   * тегов <think> в сообщениях роли assistant в истории диалога.
   */
  static stripReasoning(text: string): string {
    if (!text) return '';
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }

  /**
   * Phase 2: генерация текстовой сводки для старых сообщений.
   *
   * Формат: «User: <краткое содержание> / Assistant: <краткое содержание>»
   * Без вызова провайдера — детерминированная компрессия для стабильного prefix caching.
   * Реальная LLM-сводка добавляется в Phase 3.
   */
  static generateSummary(
    messages: IncomingMessage[],
    language?: Language,
  ): string {
    if (messages.length === 0) return '';

    const prefix = language === 'en' ? 'Conversation summary' : 'Краткий контекст беседы';
    const snippets = messages.map((m) => {
      const role = m.role === 'user'
        ? (language === 'en' ? 'User' : 'Пользователь')
        : (language === 'en' ? 'Assistant' : 'Ассистент');
      // Берём первые 200 символов — достаточно для понимания контекста
      const snippet = this.cleanText(
        m.role === 'assistant' ? this.stripReasoning(m.content) : m.content,
      ).slice(0, 200);
      return `${role}: ${snippet}`;
    });

    return `[${prefix}: ${snippets.join(' → ')}]`;
  }

  /**
   * Phase 2: подготовить и оптимизировать историю сообщений для отправки в модель.
   *
   * Новая схема:
   *   1. system (системный промпт)
   *   2. system (сводка старых сообщений, если история длинная)
   *   3. Первое сообщение диалога (якорь для понимания темы)
   *   4. Последние 6–8 сообщений
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
        content: this.cleanText(options.systemPrompt),
      });
    }

    if (messages.length === 0) {
      return result;
    }

    // 2. Берём скользящее окно с учётом maxMessages
    const maxMsgs = Math.max(1, options.maxMessages);
    const maxTokens = options.maxTokens ?? 120000;

    // Phase 2: новая схема — при длинной истории (>8 сообщений и лимит контекста >6)
    // сжимаем старые сообщения в сводку + сохраняем первое сообщение + последние 6–8 сообщений.
    const shouldSummarize = messages.length > 8 && maxMsgs > 6;

    if (!shouldSummarize) {
      const windowed = messages.slice(-maxMsgs);
      let currentTokens = result.reduce(
        (sum, m) => sum + this.estimateTokens(m.content),
        0,
      );

      const chosenMessages: IncomingMessage[] = [];
      for (let i = windowed.length - 1; i >= 0; i--) {
        const msg = windowed[i];
        const raw = msg.role === 'assistant' ? this.stripReasoning(msg.content) : msg.content;
        const cleaned = this.cleanText(raw);
        const msgTokens = this.estimateTokens(cleaned);

        if (chosenMessages.length > 0 && currentTokens + msgTokens > maxTokens) {
          break;
        }

        chosenMessages.unshift({ ...msg, content: cleaned });
        currentTokens += msgTokens;
      }

      for (const msg of chosenMessages) {
        result.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }

      return result;
    }

    const RECENT_COUNT = Math.min(8, maxMsgs);
    const recentMessages = messages.slice(-RECENT_COUNT);
    const olderMessages = messages.slice(0, messages.length - RECENT_COUNT);

    // 3. Вставляем сводку старых сообщений
    if (olderMessages.length > 0) {
      let summary: string;

      if (options.existingSummary) {
        summary = options.existingSummary;
      } else {
        summary = this.generateSummary(olderMessages, options.language);
        options.onSummaryGenerated?.(summary);
      }

      if (summary) {
        result.push({ role: 'system', content: summary });
      }
    }

    // 4. Первое сообщение диалога (якорь темы) — если не входит в recent
    if (messages[0]) {
      const firstMsg = messages[0];
      const firstContent = this.cleanText(
        firstMsg.role === 'assistant' ? this.stripReasoning(firstMsg.content) : firstMsg.content,
      );
      if (firstContent) {
        result.push({
          role: firstMsg.role as 'user' | 'assistant',
          content: firstContent,
        });
      }
    }

    // 5. Последние RECENT_COUNT сообщений
    let currentTokens = result.reduce(
      (sum, m) => sum + this.estimateTokens(m.content),
      0,
    );

    const chosenRecent: IncomingMessage[] = [];
    for (let i = recentMessages.length - 1; i >= 0; i--) {
      const msg = recentMessages[i];
      const raw = msg.role === 'assistant' ? this.stripReasoning(msg.content) : msg.content;
      const cleaned = this.cleanText(raw);
      const msgTokens = this.estimateTokens(cleaned);

      if (chosenRecent.length > 0 && currentTokens + msgTokens > maxTokens) {
        break;
      }

      chosenRecent.unshift({ ...msg, content: cleaned });
      currentTokens += msgTokens;
    }

    for (const msg of chosenRecent) {
      result.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }

    return result;
  }

  /**
   * Пост-процессинг: обрезка и сжатие избыточного текста для контроля выходных токенов.
   */
  static compressText(text: string, maxTokens?: number): string {
    if (!maxTokens || text.length === 0) return text;
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) return text;

    // Обрезаем по последнему законченному предложению
    const sliced = text.slice(0, maxChars);
    const lastPunctuation = Math.max(
      sliced.lastIndexOf('.'),
      sliced.lastIndexOf('!'),
      sliced.lastIndexOf('?'),
      sliced.lastIndexOf('\n'),
    );

    if (lastPunctuation > maxChars * 0.7) {
      return sliced.slice(0, lastPunctuation + 1).trim();
    }
    return sliced.trim();
  }
}
