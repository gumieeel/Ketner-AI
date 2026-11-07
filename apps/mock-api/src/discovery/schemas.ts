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
import { AREA_IDS, RECIPE_IDS } from './analysis-map.js';
import { findSiteUrl } from './site-url.js';
import { CAPABILITY_IDS, isCapabilityReleased } from './capabilities.js';
import { businessProfileOutputSchema } from './profile.js';
import { COMPLEXITIES, SOLUTION_TYPES } from '../pricing/catalog.js';

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
  /**
   * Как часто — только если пользователь сам назвал, и в том поле, в каком назвал («40 в день» —
   * `timesPerDay: 40`). Неделю из дней и месяцев считает код, с явным допущением (impact.ts).
   */
  timesPerDay: positive(500),
  timesPerWeek: positive(500),
  timesPerMonth: positive(2000),
  /** Сколько занимает один раз — минуты или часы, как назвал пользователь. */
  minutesEach: positive(24 * 60),
  hoursEach: positive(24),
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
  /**
   * Короткая реплика перед уточняющими вопросами («Понял. Давайте разберёмся, как сейчас
   * поступают заявки.»). Пустая, если вопросов нет или модель её не написала.
   */
  intro: text(200).optional(),
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
  /**
   * Структурированный профиль бизнеса (discovery/profile.ts). Модель могла его не вернуть —
   * тогда его нет, анализ от этого не ломается; человек заполнит профиль сам.
   */
  // Пометку «правил человек» ставит только сервер, не модель.
  profile: businessProfileOutputSchema
    .transform(({ edited: _edited, ...rest }) => rest)
    .optional()
    .catch(undefined),
});

export type ContextOutput = z.infer<typeof contextOutputSchema>;
export type ContextTask = z.infer<typeof contextTaskSchema>;
export type Question = z.infer<typeof questionSchema>;

// ─── Этап 2: поиск возможностей (Discovery Engine) ────────────────────────────

const capabilityId = z.enum(CAPABILITY_IDS).catch('other');

export const opportunityOutputSchema = z.object({
  title: requiredText(100),
  /** Область карты анализа (discovery/analysis-map.ts); неизвестная — null. */
  area: z.enum(AREA_IDS).nullable().optional().default(null).catch(null),
  /** Готовая автоматизация, к которой сводится возможность; сервер оставляет только доступную. */
  recipe: z.enum(RECIPE_IDS).nullable().optional().default(null).catch(null),
  problem: requiredText(400),
  solution: requiredText(500),
  // Невыпущенная возможность (services/rollout.ts) отбрасывается: модель её не видела, а
  // требование к выключенной функции не должно попасть ни в отчёт, ни в рецепт.
  requires: list(capabilityId, 6).transform((ids) =>
    [...new Set(ids)].filter(isCapabilityReleased),
  ),
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
  /**
   * Вид решения: помощник (разговор), инструмент (одна операция с входом и результатом) или
   * процесс (несколько шагов подряд). Незнакомое — null, сервер выведет вид сам.
   */
  solutionType: z.enum(SOLUTION_TYPES).nullable().optional().default(null).catch(null),
  /**
   * Работы по внедрению — id из каталога работ (pricing/catalog.ts). Часы и деньги модель не
   * пишет: незнакомый id не отбрасывается здесь, а помечается сметой как требующий проверки.
   */
  workItems: z
    .array(z.unknown())
    .default([])
    .catch([])
    .transform((items) =>
      items
        .flatMap((item) => {
          const parsed = workItemOutputSchema.safeParse(item);
          return parsed.success ? [parsed.data] : [];
        })
        .slice(0, WORK_ITEMS_MAX),
    ),
  /** Что неизвестно и влияет на объём работ. */
  unknowns: list(requiredText(160), 4).catch([]),
  /** Допущения, на которых держится оценка. */
  assumptions: list(requiredText(160), 4).catch([]),
});

/** Работ на одну возможность. */
export const WORK_ITEMS_MAX = 8;

const workItemOutputSchema = z.object({
  capability: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{1,47}$/),
  quantity: z
    .number()
    .optional()
    .default(1)
    .catch(1)
    .transform((value) =>
      Number.isFinite(value) ? Math.min(20, Math.max(1, Math.round(value))) : 1,
    ),
  complexity: z.enum(COMPLEXITIES).nullable().optional().default(null).catch(null),
  reason: text(160).default('').catch(''),
});

/** Сколько возможностей просим у модели: меньше — ответ не принимается и идёт повтор. */
export const OPPORTUNITIES_MIN = 3;
export const OPPORTUNITIES_MAX = 7;

const coverageItemSchema = z.object({
  area: z.enum(AREA_IDS),
  status: z.enum(['found', 'not_relevant', 'unclear']).catch('unclear'),
  note: text(200).default(''),
});

export const discoveryOutputSchema = z.object({
  summary: requiredText(600),
  /** Что модель увидела в каждой области карты; неизвестные области отбрасываются. */
  coverage: z
    .array(z.unknown())
    .default([])
    .transform((items) =>
      items.flatMap((item) => {
        const parsed = coverageItemSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
  opportunities: list(opportunityOutputSchema, OPPORTUNITIES_MAX).refine(
    (items) => items.length >= OPPORTUNITIES_MIN,
    `at least ${OPPORTUNITIES_MIN} opportunities`,
  ),
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
    .max(ANALYSIS_TEXT_MAX, 'text_too_long')
    // Короче 20 символов можно только ссылку: сайт прочитает сервер (discovery/site-reader.ts).
    .refine(
      (value) => value.length >= ANALYSIS_TEXT_MIN || findSiteUrl(value) !== null,
      'text_too_short',
    ),
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
