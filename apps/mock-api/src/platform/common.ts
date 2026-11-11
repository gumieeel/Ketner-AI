/**
 * Общие примитивы доменной модели платформы (docs/DOMAIN_MODEL.md).
 *
 * Модуль не знает ни об исполнителях процессов (n8n и др.), ни о рантаймах агентов: это контракты
 * Ketner. Всё, что зависит от конкретного исполнителя, — в platform/compatibility.ts.
 */

import { z } from 'zod';

export const languageSchema = z.enum(['ru', 'en']);

/** Ключ внутри спецификации: латиница, цифры, `_` и `-`. */
export const keySchema = z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/);

/**
 * Текст с ограничением длины; пустая строка допустима. Спецификации не меняют значения (без trim):
 * перевод из существующих настроек и обратно должен быть точным. Очистка ответа модели — в схемах
 * черновиков, не здесь.
 */
export const boundedText = (max: number) => z.string().max(max);
/** Непустой (не из одних пробелов) текст с ограничением длины. */
export const requiredText = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0, 'must not be blank');

/** Поле входных или выходных данных: подмножество JSON Schema без кода и внешних ссылок. */
export const fieldSchema = z
  .strictObject({
    key: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/),
    type: z.enum(['string', 'number', 'boolean', 'date', 'email', 'phone', 'url', 'enum']),
    label: requiredText(80),
    required: z.boolean().default(true),
    maxLength: z.number().int().positive().max(10_000).optional(),
    values: z.array(requiredText(60)).min(1).max(30).optional(),
  })
  .refine((field) => (field.type === 'enum') === (field.values !== undefined), {
    message: 'values are required for enum fields and only for them',
    path: ['values'],
  });

/** Форма данных: свободный текст или поля. */
export const dataShapeSchema = z
  .strictObject({
    kind: z.enum(['text', 'structured']),
    fields: z.array(fieldSchema).max(30).default([]),
  })
  .refine(
    (shape) => (shape.kind === 'text' ? shape.fields.length === 0 : shape.fields.length > 0),
    {
      message: 'text shape has no fields; structured shape needs at least one',
      path: ['fields'],
    },
  )
  .refine((shape) => new Set(shape.fields.map((field) => field.key)).size === shape.fields.length, {
    message: 'field keys must be unique',
    path: ['fields'],
  });

export type DataShape = z.infer<typeof dataShapeSchema>;

export const TEXT_SHAPE: DataShape = { kind: 'text', fields: [] };

/** Замечание проверки кодом (после схемы). */
export interface SpecIssue {
  code: string;
  /** Путь к полю спецификации, например `components.workflows.0.steps.1.action`. */
  path: string;
  message: string;
}

/** Ключи в списке не повторяются. */
export function duplicateKeys(items: ReadonlyArray<{ key: string }>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { key } of items) {
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates];
}
