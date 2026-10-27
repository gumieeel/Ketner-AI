/**
 * Лимиты Ketner Code по уровням доступа (free — до первой покупки кредитов, credits — после, plus / pro / ultra — прежние подписчики): проекты, размер файлов, число запусков агента и бюджет запуска.
 *
 * Лимиты агента лежат поверх общих (services/entitlement.ts): запуск агента тратит тот же пул
 * кредитов, что чат и картинки, поэтому здесь ограничивается то, чего общие лимиты не видят: сколько проектов хранить, сколько запусков в сутки и сколько можно потратить
 * на один запуск (один запрос пользователя превращается в десятки обращений к модели).
 *
 * Бюджет запуска Pro и Ultra рассчитан на модели этих тарифов. Типичная задача (15 шагов по ~20k
 * токенов контекста, половина из кэша) стоит: Sonnet и GPT-5.6 Sol ≈ $0.4, Grok и Terra xhigh ≈ $0.5,
 * Opus ≈ $0.75, GPT-6 Astra ≈ $1.9 (в режиме Max ≈ $2.4); крупная (25 шагов по ~35k) — в 2–2.5
 * раза дороже. Pro $2 хватает на типичную задачу любой модели и крупную на Opus и дешевле, Ultra $3 —
 * на типичную в режиме Max и крупную на Opus в режиме Max. Запуск всё равно ограничен остатком
 * кредитов: когда они кончаются, агент продолжает на бесплатной модели.
 */

import type { PlanId } from '../types.js';
import type { ProjectQuota } from '../code/types.js';

export interface CodeLimits {
  maxProjects: number;
  maxFiles: number;
  maxProjectBytes: number;
  maxFileBytes: number;
  /** Запусков агента за 24 часа. */
  runsPerDay: number;
  /** Обращений к модели в одном запуске. */
  maxSteps: number;
  /** Потолок себестоимости одного запуска на выбранной модели, USD. */
  maxRunCostUsd: number;
  /**
   * Когда бюджет выбранной модели (или лимит шагов) исчерпан, агент не останавливается, а молча
   * продолжает на модели дешевле: сначала рабочей (Ketner Pro), потом лёгкой. Это добавочные бюджеты
   * этих ступеней, USD. Общий расход запуска всё равно не выходит за остаток кредитов.
   */
  continueWorkUsd: number;
  continueLiteUsd: number;
  /** Можно ли запускать команды (тесты, сборка) в песочнице. */
  commands: boolean;
  /** Предельная длительность одной команды. */
  commandTimeoutSec: number;
  /** Длина задачи для агента, символов. */
  maxTaskChars: number;
}

const MB = 1024 * 1024;
const KB = 1024;

export const CODE_LIMITS: Record<'free' | 'plus' | 'pro' | 'ultra', CodeLimits> = {
  // До первой покупки кредитов: агент открыт, а запуск ограничен пробными кредитами ($0.20 вместе
  // с комиссией ≈ $0.21), поэтому потолок запуска равен им целиком. Команды в песочнице — после покупки.
  free: {
    maxProjects: 3,
    maxFiles: 500,
    maxProjectBytes: 5 * MB,
    maxFileBytes: 500 * KB,
    runsPerDay: 10,
    maxSteps: 20,
    maxRunCostUsd: 0.2,
    continueWorkUsd: 0.05,
    continueLiteUsd: 0.02,
    commands: false,
    commandTimeoutSec: 30,
    maxTaskChars: 8_000,
  },
  plus: {
    maxProjects: 5,
    maxFiles: 1_000,
    maxProjectBytes: 10 * MB,
    maxFileBytes: 1 * MB,
    runsPerDay: 15,
    maxSteps: 25,
    maxRunCostUsd: 0.1,
    continueWorkUsd: 0.1,
    continueLiteUsd: 0.05,
    commands: false,
    commandTimeoutSec: 60,
    maxTaskChars: 8_000,
  },
  pro: {
    maxProjects: 20,
    maxFiles: 3_000,
    maxProjectBytes: 25 * MB,
    maxFileBytes: 2 * MB,
    runsPerDay: 40,
    maxSteps: 50,
    maxRunCostUsd: 2.0,
    continueWorkUsd: 0.4,
    continueLiteUsd: 0.1,
    commands: true,
    commandTimeoutSec: 120,
    maxTaskChars: 16_000,
  },
  ultra: {
    maxProjects: 100,
    maxFiles: 10_000,
    maxProjectBytes: 100 * MB,
    maxFileBytes: 5 * MB,
    runsPerDay: 120,
    maxSteps: 100,
    maxRunCostUsd: 3.0,
    continueWorkUsd: 0.6,
    continueLiteUsd: 0.15,
    commands: true,
    commandTimeoutSec: 300,
    maxTaskChars: 32_000,
  },
};

export function getCodeLimits(plan: PlanId | string | undefined): CodeLimits {
  switch (plan) {
    // Купленные кредиты ещё остались: лимиты Ultra, расход всё равно ограничен остатком кредитов.
    case 'credits':
    case 'ultra':
      return CODE_LIMITS.ultra;
    case 'pro':
    case 'gpt-pro':
    case 'claude-pro':
    case 'gemini-pro':
      return CODE_LIMITS.pro;
    case 'plus':
      return CODE_LIMITS.plus;
    default:
      return CODE_LIMITS.free;
  }
}

export function quotaOf(limits: CodeLimits): ProjectQuota {
  return {
    maxFiles: limits.maxFiles,
    maxFileBytes: limits.maxFileBytes,
    maxProjectBytes: limits.maxProjectBytes,
  };
}
