/**
 * Схемы Builder: тела запросов API и ответы моделей (черновик помощника, судья тест-кейсов).
 * Ответ модели — данные: проходит схему, решения (включение, статусы) принимает сервер.
 */

import { z } from 'zod';

/** Сумма текста настроек ограничена: настройки уходят в каждый запрос помощника. */
export const LIMITS = {
  name: 80,
  purpose: 400,
  instructions: 3000,
  knowledge: 8000,
  examples: 6,
  exampleChars: 1200,
  restrictions: 8,
  restrictionChars: 200,
  cases: 10,
  caseInput: 1000,
  criteria: 5,
  criterionChars: 200,
  message: 4000,
} as const;

const text = (max: number) =>
  z
    .string()
    .trim()
    .transform((value) => (value.length > max ? `${value.slice(0, max - 1)}…` : value));
const requiredText = (max: number) => text(max).pipe(z.string().min(1));
const list = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(item)
    .default([])
    .transform((items) => items.slice(0, max));

export const toneSchema = z.enum(['friendly', 'neutral', 'formal', 'concise']);

/** Настройки от пользователя: строго по длине (лишнее — ошибка, а не обрезка). */
export const assistantConfigBodySchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.name),
  purpose: z.string().trim().max(LIMITS.purpose).default(''),
  instructions: z.string().trim().max(LIMITS.instructions).default(''),
  tone: toneSchema.default('friendly'),
  knowledge: z.string().trim().max(LIMITS.knowledge).default(''),
  examples: z
    .array(
      z.object({
        input: z.string().trim().min(1).max(LIMITS.exampleChars),
        output: z.string().trim().min(1).max(LIMITS.exampleChars),
      }),
    )
    .max(LIMITS.examples)
    .default([]),
  restrictions: z
    .array(z.string().trim().min(1).max(LIMITS.restrictionChars))
    .max(LIMITS.restrictions)
    .default([]),
  language: z.enum(['ru', 'en']).default('ru'),
});

export const testCaseBodySchema = z.object({
  input: z.string().trim().min(1).max(LIMITS.caseInput),
  criteria: z
    .array(z.string().trim().min(1).max(LIMITS.criterionChars))
    .min(1)
    .max(LIMITS.criteria),
});

export const createSolutionBodySchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.name),
  language: z.enum(['ru', 'en']).default('ru'),
});

export const draftBodySchema = z.object({
  analysisId: z.string().min(1).max(100),
  opportunityId: z.string().min(1).max(100),
  confirm: z.boolean().optional(),
});

export const verdictBodySchema = z.object({ verdict: z.enum(['pass', 'fail']).nullable() });

export const messageBodySchema = z.object({
  content: z.string().trim().min(1).max(LIMITS.message),
});

// ─── Ответы моделей ──────────────────────────────────────────────────────────

export const draftOutputSchema = z.object({
  name: requiredText(LIMITS.name),
  purpose: text(LIMITS.purpose).default(''),
  instructions: requiredText(LIMITS.instructions),
  tone: toneSchema.catch('friendly'),
  knowledge: text(LIMITS.knowledge).default(''),
  examples: list(
    z.object({
      input: requiredText(LIMITS.exampleChars),
      output: requiredText(LIMITS.exampleChars),
    }),
    LIMITS.examples,
  ),
  restrictions: list(requiredText(LIMITS.restrictionChars), LIMITS.restrictions),
  testCases: list(
    z.object({
      input: requiredText(LIMITS.caseInput),
      criteria: list(requiredText(LIMITS.criterionChars), LIMITS.criteria).refine(
        (items) => items.length > 0,
        'at least one criterion',
      ),
    }),
    5,
  ),
});

export const judgeOutputSchema = z.object({
  criteria: list(
    z.object({
      criterion: requiredText(LIMITS.criterionChars),
      met: z.boolean(),
      note: text(300).default(''),
    }),
    LIMITS.criteria,
  ),
  notes: text(500).default(''),
});

export type DraftOutput = z.infer<typeof draftOutputSchema>;
export type JudgeOutput = z.infer<typeof judgeOutputSchema>;
