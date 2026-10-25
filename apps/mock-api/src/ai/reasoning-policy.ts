/**
 * Политика глубины размышлений.
 *
 * Современные модели размышляют по умолчанию, а токены размышлений оплачиваются как выходные
 * (у GPT-6 Luna размышления включены на среднем уровне, у Opus 5.5, Sol, Grok и Gemini 3.8 их
 * вообще нельзя отключить). Без управления простой вопрос стоит как сложная задача.
 *
 * Вместо подмены модели на «лёгкую» (как было раньше, пользователь получал не ту модель, которую
 * выбрал) мы оставляем выбранную модель и меняем глубину размышлений: по данным Artificial Analysis
 * режим low у GPT-6.1 Sol в 2.5 раза дешевле high, у Claude Opus 5.5 в 3.3 раза.
 */

import type {
  EffortProfile,
  ModelCostClass,
  ModelReasoning,
  ProviderRequestOptions,
  ReasoningEffort,
  ReasoningMode,
} from './gateway-types.js';
import type { CreditStage } from '../services/credit-policy.js';
import { planRank } from '../services/entitlement.js';

export type PromptLevel = 'simple' | 'moderate' | 'complex';

const ORDER: readonly ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];

const PREMIUM_CLASSES: ReadonlySet<ModelCostClass> = new Set<ModelCostClass>(['strong', 'top']);

/**
 * Категории, где глубина размышлений заметно влияет на правильность ответа. Только математика:
 * код и так идёт на сильную модель, а «рассуждения» классификатор отмечает по ключевым словам
 * («объясни», «почему», «сравни»), то есть почти любой вопрос. Глубина high стоит в 2.5–3.3 раза
 * дороже low, и тратить на каждое «объясни» кредиты пользователя нельзя.
 */
const HARD_CATEGORIES: ReadonlySet<string> = new Set(['math']);

export interface EffortInput {
  level: PromptLevel;
  category: string;
  plan: string;
  stage: CreditStage;
  costClass: ModelCostClass;
  /**
   * Пользователи часто ставят дизлайк на быстрые ответы лёгких моделей: поднимаем глубину на шаг.
   * Касается только простых и обычных запросов на лёгких и рабочих моделях: оценки общие для всех
   * пользователей, и повышение глубины сложных запросов или премиум-моделей удорожало бы весь сервис.
   */
  escalate?: boolean;
}

/**
 * Желаемая глубина размышлений для запроса.
 *
 *   simple   → none   (приветствие, короткий вопрос)
 *   moderate → low
 *   complex  → medium
 *   complex  → high   только если глубина реально окупается: Ultra на top-модели
 *                     либо математика на премиум-модели у Pro и выше.
 * Когда кредиты кончились (отвечает бесплатная модель), глубина ограничивается уровнем low.
 */
export function chooseReasoningEffort(input: EffortInput): ReasoningEffort {
  let index = input.level === 'simple' ? 0 : input.level === 'moderate' ? 1 : 2;

  if (input.level === 'complex') {
    const rank = planRank(input.plan);
    const premium = PREMIUM_CLASSES.has(input.costClass);
    const heavyTop = input.costClass === 'top' && rank >= planRank('ultra');
    const heavyCategory = premium && rank >= planRank('pro') && HARD_CATEGORIES.has(input.category);
    if (heavyTop || heavyCategory) {
      index = 3;
    }
  }

  if (input.escalate && index < 2 && !PREMIUM_CLASSES.has(input.costClass)) {
    index += 1;
  }

  if (input.stage !== 'normal') {
    index = Math.min(index, 1);
  }

  return ORDER[index];
}

function nearestSupported(
  supported: readonly ReasoningEffort[],
  wanted: ReasoningEffort,
  mandatory: boolean,
): ReasoningEffort {
  const allowed = supported.filter((e) => !(mandatory && e === 'none'));
  if (allowed.includes(wanted)) return wanted;

  const target = ORDER.indexOf(wanted);
  const preferHigher = target >= ORDER.indexOf('medium');
  let best = allowed[0];
  let bestDistance = Infinity;
  for (const effort of allowed) {
    const distance = Math.abs(ORDER.indexOf(effort) - target);
    const better =
      distance < bestDistance ||
      (distance === bestDistance &&
        (preferHigher
          ? ORDER.indexOf(effort) > ORDER.indexOf(best)
          : ORDER.indexOf(effort) < ORDER.indexOf(best)));
    if (better) {
      best = effort;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Приводит желаемую глубину к тому, что модель реально принимает. Отправлять значение, которого
 * нет в списке модели, нельзя: OpenRouter ответит ошибкой. Если управлять нечем, параметр не
 * передаётся и модель работает со своим значением по умолчанию.
 */
export function toProviderReasoning(
  reasoning: ModelReasoning,
  wanted: ReasoningEffort,
): ProviderRequestOptions['reasoning'] | undefined {
  if (reasoning.efforts.length > 0) {
    return { effort: nearestSupported(reasoning.efforts, wanted, reasoning.mandatory) };
  }
  if (reasoning.toggle) {
    return { enabled: reasoning.mandatory ? true : wanted !== 'none' };
  }
  return undefined;
}

/** Режим Max доступен только на Ultra (VIP получает Ultra как эффективный тариф). */
export function isMaxModeAllowed(plan: string): boolean {
  return planRank(plan) >= planRank('ultra');
}

/** Режим, который реально действует: max на тарифе ниже Ultra превращается в standard. */
export function effectiveReasoningMode(
  requested: ReasoningMode | undefined,
  plan: string,
): ReasoningMode {
  return requested === 'max' && isMaxModeAllowed(plan) ? 'max' : 'standard';
}

/**
 * Глубина для модели с фиксированным профилем (модели Pro и Ultra): standard — medium, max — xhigh,
 * у моделей вроде «Grok 4.7 xhigh» оба режима одинаковые. Когда кредиты кончились, глубина не выше
 * low: цена размышлений растёт с глубиной в разы.
 */
export function profileEffort(
  profile: EffortProfile,
  mode: ReasoningMode,
  stage: CreditStage,
): ReasoningEffort {
  const effort = mode === 'max' ? profile.max : profile.standard;
  return stage === 'normal' ? effort : 'low';
}

export function isPremiumClass(costClass: ModelCostClass): boolean {
  return PREMIUM_CLASSES.has(costClass);
}

export interface OutputCapInput {
  /** Потолок ответа тарифа (PlanEntitlements.maxTokens). */
  planMaxTokens: number;
  /** Потолок выходных токенов самой модели. */
  modelMaxOutputTokens: number;
  stage: CreditStage;
  level: PromptLevel;
  /** К запросу приложен проект или файлы: ответ может быть большим. */
  heavyContext: boolean;
  /** Глубина размышлений запроса: от high и выше размышлениям нужен запас, короткий потолок их обрежет. */
  effort?: ReasoningEffort;
}

/** Нижняя граница: ответ с размышлениями короче этого обрывается, не успев начаться. */
const MIN_OUTPUT_CAP = 1024;

/**
 * Предельное число выходных токенов (размышления входят в него).
 *
 * Выходные токены — самая дорогая часть запроса, поэтому потолок следует за кредитами: когда они
 * кончились, ответ бесплатной модели не длиннее 2048 токенов. Простой
 * вопрос без проекта и файлов тоже не требует длинного ответа. Платится только фактически
 * сгенерированное, потолок защищает от самого дорогого сценария: модель, которая «разговорилась».
 */
export function computeOutputCap(input: OutputCapInput): number {
  let cap = Math.min(input.modelMaxOutputTokens, input.planMaxTokens);
  if (input.stage === 'exhausted') cap = Math.min(cap, 2048);
  const deepReasoning =
    input.effort !== undefined && ORDER.indexOf(input.effort) >= ORDER.indexOf('high');
  if (input.level === 'simple' && !input.heavyContext && !deepReasoning) cap = Math.min(cap, 2048);
  return Math.max(cap, Math.min(MIN_OUTPUT_CAP, input.modelMaxOutputTokens));
}
