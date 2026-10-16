/**
 * Лимиты запросов по моделям: недельный пул и защита от выжигания за сутки.
 *
 * Помимо месячного бюджета себестоимости и квоты премиум-запросов у каждой модели тарифа есть своя
 * суточная норма (`DAILY_MODEL_LIMITS`). Норма — не жёсткий потолок на сутки, а основа недельного
 * пула: за скользящие 7 дней можно получить `норма × 7` ответов модели и тратить их неравномерно
 * (в понедельник 10 запросов Opus, во вторник ни одного). Чтобы пул не сгорал за один вечер, за
 * скользящие сутки берётся не больше 40% пула (но не меньше прежней суточной нормы).
 *
 * За 30 дней пул даёт те же ≈ 30 × норма ответов, что и прежний суточный лимит, а месячные
 * costBudget и premiumBudget не менялись: худший случай по марже прежний.
 *
 * Когда пул или суточная доля исчерпаны, отвечает запасная модель из реестра (`fallbackModelId`):
 * дешевле, но по возможности близкая по качеству; когда исчерпаны и её лимиты — следующая.
 * Замена видна в `selectedModel` и `routingReason`, скрытой подмены нет.
 *
 * Лимиты заданы тарифу и модели: нет записи — модель без лимита. Старые тарифы (gpt-pro,
 * claude-pro, gemini-pro) получают лимиты Pro.
 *
 * Запрос в режиме Max (только Ultra) у модели с профилем размышлений поднимает глубину medium → xhigh,
 * стоит примерно в 2.4 раза дороже и считается за 2 (UsageRecord.limitUnits).
 *
 * Как выбирались нормы (полный расчёт: docs/models-and-pricing.md). Типичный запрос — 7.6k токенов
 * входа, выход 2k при medium и 7k при xhigh.
 *
 * Plus: квота премиум-моделей $1.30. Норма Sol 2 в сутки: 60 × $0.027 ≈ $1.64 в месяц,
 * дальше квота сама переключает на work-модели.
 *
 * Pro и Ultra: норма модели = квота премиум-моделей тарифа / 30 дней / цена запроса этой модели,
 * то есть если пользоваться одной моделью каждый день до нормы, квоты хватает примерно на месяц.
 * Квота общая: несколько моделей сразу расходуют её быстрее, и тогда отвечают модели класса work.
 *   Pro   (квота $7 → $0.23 в день): Opus $0.070 → 3, Sonnet и Sol $0.035 → 6, Astra $0.176 → 1,
 *         Grok xhigh $0.057 → 4, Terra xhigh $0.099 → 2.
 *   Ultra (квота $15 → $0.50 в день): Opus 7, Sonnet и Sol 14, Astra 3, Grok 8, Terra 5.
 * GLM-5.3 (открытая флагманская модель, класс work, $0.019 за запрос) — по цене относительно
 * Gemini 3.7 Flash ($0.013 → 5 / 15 / 40): Plus 3, Pro 10, Ultra 25. Квоту премиум-моделей не тратит;
 * Auto на Pro и Ultra отдаёт ей задачи средней сложности вместо GPT-6.1 Sol, после лимита отвечает
 * Ketner Pro.
 * Худший случай (пользователь выбирает все лимиты) ограничен месячным бюджетом и его стадиями
 * 80% / 100% / 125%: маржа Pro ≈ 34%, Ultra ≈ 36% с учётом Free-тира, не ниже 24% и 30%
 * на жёстком пределе.
 */

import type { PlanId } from '../types.js';

/** Нормы: тариф → id модели → запросов в сутки (основа недельного пула). */
export const DAILY_MODEL_LIMITS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  plus: {
    'gpt-6.1-sol': 2,
    'ketner-pro': 20,
    'gemini-3.7-flash': 5,
    'glm-5.3': 3,
    'gpt-5.6-luna-pro': 10,
    'qwen3.8-27b': 12,
  },
  pro: {
    'gpt-6-astra': 1,
    'claude-opus-5.5': 3,
    'gpt-5.6-terra': 2,
    'claude-sonnet-5.5': 6,
    'gpt-5.6-sol': 6,
    'gemini-4-argon': 6,
    'grok-4.7': 4,
    // Модели Plus на Pro: тот же принцип, запас больше.
    'gpt-6.1-sol': 6,
    'gemini-3.8-flash': 15,
    'gemini-3.7-flash': 15,
    'glm-5.3': 10,
    'ketner-pro': 60,
    'gpt-5.6-luna-pro': 30,
    'qwen3.8-27b': 40,
  },
  ultra: {
    'gpt-6-astra': 3,
    'claude-opus-5.5': 7,
    'gpt-5.6-terra': 5,
    'claude-sonnet-5.5': 14,
    'gpt-5.6-sol': 14,
    'gemini-4-argon': 14,
    'grok-4.7': 8,
    'gpt-6.1-sol': 14,
    'gemini-3.8-flash': 40,
    'gemini-3.7-flash': 40,
    'glm-5.3': 25,
    'ketner-pro': 150,
    'gpt-5.6-luna-pro': 80,
    'qwen3.8-27b': 100,
  },
};

/** Старые тарифы с доступом уровня Pro пользуются лимитами Pro. */
const PLAN_ALIASES: Readonly<Record<string, string>> = {
  'gpt-pro': 'pro',
  'claude-pro': 'pro',
  'gemini-pro': 'pro',
};

function limitsOf(plan: PlanId | string | undefined): Readonly<Record<string, number>> | undefined {
  if (!plan) return undefined;
  return DAILY_MODEL_LIMITS[PLAN_ALIASES[plan] ?? plan];
}

/** Суточная норма модели на тарифе или null, если лимита нет. */
export function getDailyModelLimit(
  plan: PlanId | string | undefined,
  modelId: string,
): number | null {
  const limit = limitsOf(plan)?.[modelId];
  return typeof limit === 'number' && limit >= 0 ? limit : null;
}

/** Все суточные нормы тарифа (для /api/meta и интерфейса). */
export function getDailyModelLimits(plan: PlanId | string | undefined): Record<string, number> {
  return { ...(limitsOf(plan) ?? {}) };
}

/** Пул считается за скользящие 7 дней. */
export const WEEKLY_POOL_DAYS = 7;
/** Защита от выжигания: за скользящие сутки — не больше этой доли недельного пула. */
export const DAILY_BURST_SHARE = 0.4;

export interface ModelLimit {
  /** Суточная норма (основа пула). */
  daily: number;
  /** Недельный пул: норма × 7 за скользящие 7 дней. */
  weeklyPool: number;
  /** Сколько можно взять из пула за скользящие сутки. */
  dailyCap: number;
}

/** Лимит модели на тарифе (пул и суточная доля) или null, если лимита нет. */
export function getModelLimit(
  plan: PlanId | string | undefined,
  modelId: string,
): ModelLimit | null {
  const daily = getDailyModelLimit(plan, modelId);
  if (daily === null) return null;
  const weeklyPool = daily * WEEKLY_POOL_DAYS;
  return {
    daily,
    weeklyPool,
    dailyCap: Math.max(daily, Math.floor(weeklyPool * DAILY_BURST_SHARE)),
  };
}
