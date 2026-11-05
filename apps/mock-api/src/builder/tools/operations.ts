/**
 * Операции инструментов: что инструмент умеет делать над материалами пользователя.
 *
 * Операция — код, а не настройка: схема входа, промпты, схема ответа модели (zod) и правила ссылок
 * на источники. Исполнитель (executor.ts) один на все операции: цена до запуска, подтверждение,
 * идемпотентность, запуск через AI Gateway с потолком списания, хранение результата. Новый
 * инструмент в другой области — новые операции в реестре, исполнитель не меняется.
 */
import type { z } from 'zod';
import type { ReasoningEffort } from '../../ai/gateway-types.js';
import type { Language } from '../../types.js';
import type { TemplateId } from '../templates.js';

/** Часть материала, которую видит модель: под коротким id (`S1`, `S2`…), а не под id из базы. */
export interface SourceText {
  ref: string;
  materialId: string;
  materialName: string;
  sectionId: string;
  label: string;
  text: string;
}

/** Источник в сохранённом запуске: без текста — результат ссылается на него по `ref`. */
export type RunSource = Omit<SourceText, 'text'>;

/** Какие материалы и части берёт запуск. Пустой `sections` — все части документа. */
export interface MaterialSelection {
  id: string;
  sections?: string[];
}

export interface OperationPolicy {
  modelId: string;
  maxOutputTokens: number;
  reasoningEffort: ReasoningEffort;
}

export interface ToolOperation<Input = unknown, Output = unknown> {
  /** id внутри шаблона: `notes`, `table`… */
  id: string;
  template: TemplateId;
  label: Record<Language, string>;
  policy: OperationPolicy;
  /** Вход от пользователя: проверяется строго, лишнее — ошибка. */
  inputSchema: z.ZodType<Input>;
  /** Материалы, которые нужны запуску. */
  materials(input: Input): MaterialSelection[];
  /** Короткая подпись запуска для списка: предмет, тема. */
  subject(input: Input): string;
  systemPrompt(language: Language): string;
  /** Сообщение с данными: материалы и пожелания — только внутри разметки данных. */
  userMessage(input: Input, sources: readonly SourceText[], language: Language): string;
  /** Схема ответа модели; ссылки на источники проверяются по известным `refs`. */
  outputSchema(refs: ReadonlySet<string>): z.ZodType<Output>;
  /** Ответ для demo-режима без ключей моделей (локально, тесты): по настоящим источникам. */
  templateOutput(input: Input, sources: readonly SourceText[], language: Language): string;
}
