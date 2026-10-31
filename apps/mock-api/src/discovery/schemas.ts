/**
 * Схемы ответов моделей на этапах анализа и тел запросов API.
 *
 * Ответ модели — данные, а не команды: он проходит схему, а всё, что решает сервер (реализуемость,
 * польза, приоритет, цены, квоты), считается кодом. Схемы терпимы к форме (длинная строка
 * обрезается, лишнее поле отбрасывается, пропущенный список становится пустым) и строги к смыслу
 * (типы, перечисления, обязательные поля): из-за мелочи не нужен повторный платный вызов, а
 * ответ не той структуры не показывается пользователю.
 */

import { z } from 'zod';
import { PLATFORM_LIMITS } from '../services/discovery-limits.js';
import { CAPABILITY_IDS } from './capabilities.js';

/** Строка: обрезаются пробелы, длина ограничивается обрезкой, а не отказом. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .transform((value) => (value.length > max ? `${value.slice(0, max - 1)}…` : value));

const requiredText = (max: number) => text(max).pipe(z.string().min(1));

/** Список: лишние элементы отбрасываются; пропущенный список — пустой. */
const list = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(item)
    .default([])
    .transform((items) => items.slice(0, max));

const source = z.enum(['user', 'inferred']).catch('inferred');

const sourced = (max: number) => z.object({ text: requiredText(max), source });

/** Число из текста пользователя: только положительное и правдоподобное, иначе null. */
const positive = (max: number) =>
  z
    .number()
    .nullable()
    .optional()
    .transform((value) =>
      typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max
        ? value
        : null,
    );

// ─── Этап 1: разбор задачи (Context Analyzer) ─────────────────────────────────

export const contextTaskSchema = z.object({
  id: requiredText(8),
  title: requiredText(160),
  /** Сколько раз в неделю — только если пользователь сам назвал. */
  timesPerWeek: positive(500),
  /** Сколько минут занимает один раз — только если пользователь сам назвал. */
  minutesEach: positive(24 * 60),
  /** Дословная цитата из описания, откуда взяты числа (сервер проверяет, что она там есть). */
  evidence: text(240).nullable().optional().default(null),
  source,
});

export const questionSchema = z.object({
  id: requiredText(8),
  text: requiredText(220),
  /** Зачем вопрос: что изменится в результате. */
  reason: text(220).default(''),
  optional: z.boolean().catch(true),
  kind: z.enum(['text', 'choice']).catch('text'),
  options: list(requiredText(80), 6).optional(),
});

export const contextOutputSchema = z.object({
  domain: requiredText(120),
  summary: requiredText(500),
  goals: list(sourced(220), 6),
  tasks: list(contextTaskSchema, 8),
  recurringProcesses: list(
    z.object({ title: requiredText(160), steps: list(requiredText(160), 8) }),
    5,
  ),
  tools: list(sourced(80), 10),
  constraints: list(sourced(220), 6),
  availableData: list(sourced(220), 6),
  missing: list(z.object({ field: requiredText(80), why: text(220).default('') }), 6),
  questions: list(questionSchema, PLATFORM_LIMITS.analyses.maxQuestions),
});

export type ContextOutput = z.infer<typeof contextOutputSchema>;
export type ContextTask = z.infer<typeof contextTaskSchema>;
export type Question = z.infer<typeof questionSchema>;

// ─── Этап 2: поиск возможностей (Discovery Engine) ────────────────────────────

const capabilityId = z.enum(CAPABILITY_IDS).catch('other');

export const opportunityOutputSchema = z.object({
  title: requiredText(100),
  problem: requiredText(400),
  solution: requiredText(500),
  requires: list(capabilityId, 6).transform((ids) => [...new Set(ids)]),
  /** Что именно нужно, если в `requires` есть `other`. */
  otherRequirement: text(200).nullable().optional().default(null),
  dataNeeded: list(requiredText(160), 5),
  integrationsNeeded: list(requiredText(120), 5),
  effort: z.enum(['low', 'medium', 'high']).catch('medium'),
  effortReason: text(220).default(''),
  risks: list(requiredText(200), 4),
  limitations: list(requiredText(200), 4),
  successCriteria: list(requiredText(200), 4),
  impact: z
    .object({
      /** id задачи из разбора, к которой относится польза; null — не привязана к задаче с числами. */
      taskId: text(8).nullable().optional().default(null),
      automationShare: z.enum(['low', 'medium', 'high']).catch('low'),
      benefit: requiredText(300),
    })
    .default({ taskId: null, automationShare: 'low', benefit: '—' }),
  firstStep: text(220).default(''),
});

export const discoveryOutputSchema = z.object({
  summary: requiredText(600),
  opportunities: list(opportunityOutputSchema, 7),
});

export type OpportunityOutput = z.infer<typeof opportunityOutputSchema>;
export type DiscoveryOutput = z.infer<typeof discoveryOutputSchema>;

// ─── Этап 3: план внедрения (Plan Generator) ──────────────────────────────────

export const planStepOutputSchema = z.object({
  id: requiredText(8),
  title: requiredText(120),
  description: text(600).default(''),
  /** id шагов, которые нужно сделать раньше; сервер оставляет только ссылки на предыдущие шаги. */
  dependsOn: list(text(8), 6),
  /** Критерий готовности шага. */
  doneWhen: text(220).default(''),
});

export const planOutputSchema = z.object({
  summary: requiredText(400),
  steps: list(planStepOutputSchema, 10).refine((steps) => steps.length > 0, 'at least one step'),
  risks: list(requiredText(200), 4),
  successCriteria: list(requiredText(200), 4),
});

export type PlanOutput = z.infer<typeof planOutputSchema>;

// ─── Тела запросов API ────────────────────────────────────────────────────────

/** Совпадает с лимитом сайта (apps/web/src/features/discovery/draft.ts). */
export const ANALYSIS_TEXT_MAX = PLATFORM_LIMITS.analyses.textChars;
export const ANALYSIS_TEXT_MIN = 20;
export const ANSWER_MAX = 2000;

export const createAnalysisBodySchema = z.object({
  text: z
    .string()
    .trim()
    .min(ANALYSIS_TEXT_MIN, 'text_too_short')
    .max(ANALYSIS_TEXT_MAX, 'text_too_long'),
  language: z.enum(['ru', 'en']).default('ru'),
  /** Не указан — бесплатный анализ, если он доступен. */
  mode: z.enum(['free', 'paid', 'deep']).optional(),
  /** Согласие на дорогую операцию («Глубокий анализ»). */
  confirm: z.boolean().optional(),
});

const answersRecord = z
  .record(
    z.string().max(8),
    z.union([
      z.object({ skipped: z.literal(true) }),
      z.object({ value: z.string().trim().min(1).max(ANSWER_MAX) }),
    ]),
  )
  .default({});

export const answersBodySchema = z.object({
  answers: answersRecord,
  /** Согласие на списание: повторный поиск возможностей после изменения ответов платный. */
  confirm: z.boolean().optional(),
});

/** Черновик ответов: сохраняется без запуска модели, чтобы прогресс пережил перезагрузку. */
export const answersDraftBodySchema = z.object({ answers: answersRecord });

export const PLAN_STEP_STATUSES = ['todo', 'in_progress', 'done', 'skipped'] as const;

export const planStepBodySchema = z.object({ status: z.enum(PLAN_STEP_STATUSES) });

export type CreateAnalysisBody = z.infer<typeof createAnalysisBodySchema>;
export type AnswersBody = z.infer<typeof answersBodySchema>;
