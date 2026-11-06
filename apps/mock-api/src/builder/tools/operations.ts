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
import type { Attempt } from './attempt-store.js';
import type { ToolRun } from './run-store.js';

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

/** Что видит схема ответа: известные ссылки, тексты частей (для проверки цитат) и вход запуска. */
export interface OutputContext<Input = unknown> {
  refs: ReadonlySet<string>;
  sources: readonly SourceText[];
  input: Input;
}

/** Прежние результаты владельца в этом инструменте: для операций над ними (проверка ответов). */
export interface OperationContext {
  userId: string;
  solutionId: string;
  run(id: string): Promise<ToolRun | null>;
  attempt(id: string): Promise<Attempt | null>;
}

export type ResolveResult<Input> =
  | { ok: true; input: Input; materials: MaterialSelection[] }
  | { ok: false; status: number; code: string; message: Record<Language, string> };

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
  /** Схема ответа модели: ссылки — только на известные части, цитаты — из их текста. */
  outputSchema(context: OutputContext<Input>): z.ZodType<Output>;
  /** Ответ для demo-режима без ключей моделей (локально, тесты): по настоящим источникам. */
  templateOutput(input: Input, sources: readonly SourceText[], language: Language): string;
  /**
   * Служебная операция: запускается только своим сервисом (проверка ответов — из попытки), а не
   * общим API запусков.
   */
  internal?: boolean;
  /**
   * Операция над прежними результатами: дополнить вход данными из хранилищ (ответы попытки,
   * вопросы теста) и выбрать части материалов. Без неё материалы берутся из `materials(input)`.
   */
  resolve?(input: Input, context: OperationContext): Promise<ResolveResult<Input>>;
  /** Результат для сайта: например, без ключей ответов, пока попытка не сдана. */
  present?(result: Output): unknown;
}
