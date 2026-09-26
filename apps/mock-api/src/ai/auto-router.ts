/**
 * Auto Mode Router — score-based интеллектуальная маршрутизация запросов.
 *
 * Ядро системы оптимизации себестоимости Ketner AI.
 *
 * Для каждого запроса каждая доступная модель получает числовой score:
 *
 *   score = taskMatch  * W_TASK
 *         + quality    * W_QUALITY
 *         + tierBonus  * W_TIER
 *         + latency    * W_SPEED
 *         - cost       * W_COST
 *         - budgetPen  * W_BUDGET
 *         - lengthPen  * W_LENGTH
 *
 * Маршрутизатор выбирает модель с наивысшим score.
 * Это НЕ if/else маршрутизация — это числовая оптимизация:
 *   quality / cost / user tier / task fit
 *
 * ВАЖНО: AutoRouter используется ТОЛЬКО когда пользователь выбрал 'auto'
 * или не указал модель. Явно выбранная модель НИКОГДА не подменяется.
 */

import type { ModelRegistryEntry, TaskCategory, TaskClassification } from './gateway-types.js';

// ─────────────────────────────────────────────────────────────
// Типы
// ─────────────────────────────────────────────────────────────

export interface AutoRouterOptions {
  /** Текущий тарифный план пользователя. */
  userPlan?: string;
  /** Превышен ли месячный бюджет себестоимости. */
  budgetExceeded?: boolean;
  /** Текущий месячный расход пользователя на AI ($). */
  monthlyCost?: number;
  /** Месячный бюджет лимита для пользователя ($). */
  monthlyBudget?: number;
}

/** Результат скоринга одной модели (для отладки / логов). */
export interface ModelScore {
  modelId: string;
  modelName: string;
  score: number;
  breakdown: {
    taskMatch: number;
    quality: number;
    tierBonus: number;
    latency: number;
    cost: number;
    budgetPenalty: number;
    lengthPenalty: number;
  };
}

/** Результат маршрутизации с полной прозрачностью. */
export interface RoutingResult {
  model: ModelRegistryEntry;
  reason: string;
  scores?: ModelScore[];
}

// ─────────────────────────────────────────────────────────────
// Веса (самое важное — баланс бизнеса)
// ─────────────────────────────────────────────────────────────

const W = {
  TASK:    3,    // Совместимость задачи с моделью
  QUALITY: 2,    // Качество модели
  TIER:    1.5,  // Бонус за тариф пользователя
  SPEED:   1,    // Скорость отклика
  COST:    3,    // Штраф за стоимость (чем дороже — тем хуже)
  BUDGET:  4,    // Штраф за приближение к бюджету
  LENGTH:  1.5,  // Штраф за длинные промпты на дорогих моделях
} as const;

// ─────────────────────────────────────────────────────────────
// Параметры моделей (quality / speed / cost нормализованы 0–1)
// ─────────────────────────────────────────────────────────────

interface ModelProfile {
  quality: number;   // 0–1: общее качество модели
  speed: number;     // 0–1: скорость отклика (1 = мгновенно)
  cost: number;      // 0–1: нормализованная стоимость (1 = самая дорогая)
}

/**
 * Профили моделей.
 * Вычислены из реальных pricing: cost = (inputPrice + outputPrice) / max(inputPrice + outputPrice).
 * quality и speed — экспертная оценка производительности.
 */
const MODEL_PROFILES: Record<string, ModelProfile> = {
  // ─ Дешёвые модели (включая бесплатные OpenRouter) ─
  'ketner-mini':        { quality: 0.75, speed: 0.95, cost: 0.00 }, // Qwen 3.8 27B Free (OpenRouter)
  'nemotron-ultra':     { quality: 0.85, speed: 1.00, cost: 0.00 }, // NVIDIA Nemotron 3 Ultra Free (OpenRouter)
  'glm-5.3-flash':      { quality: 0.86, speed: 0.92, cost: 0.03 }, // Z.ai GLM 5.3 Flash (OpenRouter)
  'deepseek-v4.1-flash': { quality: 0.90, speed: 0.90, cost: 0.04 }, // DeepSeek V4.1 Flash (OpenRouter)
  'gpt-4o-mini':        { quality: 0.65, speed: 0.90, cost: 0.04 },
  'gemini-2.5-flash':   { quality: 0.68, speed: 0.95, cost: 0.04 },
  'claude-3-haiku':     { quality: 0.62, speed: 0.90, cost: 0.08 },

  // ─ Средние ─
  'gpt-4o':             { quality: 0.88, speed: 0.82, cost: 0.35 },
  'ketner-pro':         { quality: 0.78, speed: 0.80, cost: 0.09 },

  // ─ Флагманы (ядро продукта) ─
  'gpt-6-astra':        { quality: 1.0,  speed: 0.70, cost: 0.69 },
  'claude-3.5-sonnet':  { quality: 0.97, speed: 0.65, cost: 1.00 },
  'claude-fable':       { quality: 0.97, speed: 0.65, cost: 1.00 },
  'gemini-2.5-pro':     { quality: 0.93, speed: 0.60, cost: 0.63 },
  'gemini-pro':         { quality: 0.93, speed: 0.60, cost: 0.63 },
};

/** Возвращает профиль модели (с fallback для неизвестных). */
function getProfile(modelId: string): ModelProfile {
  return MODEL_PROFILES[modelId] ?? { quality: 0.5, speed: 0.7, cost: 0.5 };
}

// ─────────────────────────────────────────────────────────────
// Бонусы тарифов
// ─────────────────────────────────────────────────────────────

const TIER_BONUSES: Record<string, number> = {
  free:  0,
  plus:  0.1,
  pro:   0.2,
  ultra: 0.4,
  // Legacy
  'gpt-pro':    0.2,
  'claude-pro': 0.2,
  'gemini-pro': 0.2,
};

function getTierBonus(plan: string): number {
  return TIER_BONUSES[plan] ?? 0;
}

// ─────────────────────────────────────────────────────────────
// Task-Model Fit (ключевая матрица)
// ─────────────────────────────────────────────────────────────

/**
 * Насколько хорошо модель подходит для конкретного типа задачи.
 * Значения 0–1. Чем выше — тем лучше модель для этой задачи.
 *
 * Если модель имеет capability флаг для задачи, она получает полный балл.
 * Иначе — базовый 0.3 (может ответить, но не специализирована).
 */
function computeTaskMatch(
  model: ModelRegistryEntry,
  category: TaskCategory,
): number {
  const caps = model.capabilities;

  switch (category) {
    case 'coding':
      return caps.coding ? 1 : 0.3;
    case 'math':
      return caps.math ? 1 : (caps.reasoning ? 0.6 : 0.3);
    case 'reasoning':
      return caps.reasoning ? 1 : 0.3;
    case 'creative':
      return caps.creative ? 1 : 0.4;
    case 'translation':
      return caps.translation ? 1 : 0.4;
    case 'research':
      return caps.research ? 1 : (caps.reasoning ? 0.5 : 0.3);
    case 'vision':
      return caps.vision ? 1 : 0;
    case 'general':
    default:
      // Для общих запросов все модели подходят примерно одинаково;
      // побеждает та, у которой лучшее соотношение quality/cost.
      return 0.7;
  }
}

// ─────────────────────────────────────────────────────────────
// Scoring Engine — сердце системы
// ─────────────────────────────────────────────────────────────

function computeScore(
  model: ModelRegistryEntry,
  profile: ModelProfile,
  category: TaskCategory,
  userPlan: string,
  budgetRatio: number,   // monthlyCost / budget (0–1+)
  promptLength: number,
): ModelScore {
  // 1. Task match: модель подходит для задачи?
  const taskMatch = computeTaskMatch(model, category);

  // 2. Quality: общее качество модели
  const quality = profile.quality;

  // 3. Tier bonus: платящие пользователи получают бонус к флагманам
  const tierBonus = getTierBonus(userPlan);

  // 4. Latency: быстрые модели лучше для UX
  const latency = profile.speed;

  // 5. Cost penalty: дорогие модели штрафуются
  const cost = profile.cost;

  // 6. Budget penalty: чем ближе к лимиту — тем жёстче штраф
  //    Clamp [0, 1.5]: если budget exceeded → penalty > 1 → очень сильный штраф
  const budgetPenalty = Math.min(budgetRatio, 1.5);

  // 7. Length penalty: длинные промпты на дорогих моделях стоят ОЧЕНЬ дорого
  //    Начинается с 500 символов, максимальный штраф при 5000+
  const lengthFactor = promptLength > 500
    ? Math.min((promptLength - 500) / 4500, 1) * cost
    : 0;

  const score =
    taskMatch    * W.TASK +
    quality      * W.QUALITY +
    tierBonus    * W.TIER +
    latency      * W.SPEED -
    cost         * W.COST -
    budgetPenalty * W.BUDGET -
    lengthFactor * W.LENGTH;

  return {
    modelId: model.id,
    modelName: model.name,
    score,
    breakdown: {
      taskMatch,
      quality,
      tierBonus: tierBonus,
      latency,
      cost,
      budgetPenalty,
      lengthPenalty: lengthFactor,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Классификация задач (NLP-lite)
// ─────────────────────────────────────────────────────────────

export class AutoRouter {
  /**
   * Классифицировать задачу по тексту промпта.
   */
  static classify(prompt: string): TaskClassification {
    const text = prompt.toLowerCase();

    // 1. Кодинг / разработка
    const codeKeywords = [
      'function', 'const ', 'let ', 'var ', 'class ', 'import ', 'export ',
      'def ', 'return', 'async', 'await', 'interface ', 'type ',
      'sql', 'select ', 'insert ', 'docker', 'git ', 'commit',
      'html', 'css', 'javascript', 'typescript', 'python', 'react', 'vue',
      'баг', 'ошибка', 'код', 'функци', 'скрипт', 'рефакторинг', 'тест',
      'напиши код', 'исправь', 'debug', 'refactor', 'api', 'endpoint',
      'component', 'hook', 'query', 'mutation', 'migration',
    ];
    const isCode = codeKeywords.some((kw) => text.includes(kw)) || prompt.includes('```');

    // 2. Математика
    const mathKeywords = [
      'вычисли', 'посчитай', 'уравнение', 'интеграл', 'производная', 'формула',
      'calculate', 'solve', 'equation', 'integral', 'derivative', 'probability',
      'вероятность', 'матрица', 'matrix', 'theorem', 'теорема', 'доказательство',
    ];
    const isMath = mathKeywords.some((kw) => text.includes(kw));

    // 3. Рассуждения / глубокий анализ
    const reasoningKeywords = [
      'почему', 'сравни', 'проанализируй', 'в чём разница', 'архитектура',
      'преимущества и недостатки', 'why', 'compare', 'analyze', 'difference between',
      'step by step', 'пошагово', 'explain', 'объясни', 'оцени',
      'pros and cons', 'trade-offs', 'рассуди',
    ];
    const isReasoning = reasoningKeywords.some((kw) => text.includes(kw));

    // 4. Перевод
    const translationKeywords = [
      'переведи', 'перевод', 'translate', 'translation',
      'на английский', 'на русский', 'to english', 'to russian',
    ];
    const isTranslation = translationKeywords.some((kw) => text.includes(kw));

    // 5. Креатив / тексты
    const creativeKeywords = [
      'напиши статью', 'эссе', 'сочинение', 'стихотворение', 'пост', 'рассказ',
      'write an essay', 'poem', 'story', 'blog post', 'write a', 'напиши текст',
      'перепиши', 'rewrite', 'summarize', 'резюмируй', 'краткое содержание',
    ];
    const isCreative = creativeKeywords.some((kw) => text.includes(kw));

    // 6. Research
    const researchKeywords = [
      'найди', 'search', 'research', 'исследование', 'обзор',
      'review', 'survey', 'state of the art',
    ];
    const isResearch = researchKeywords.some((kw) => text.includes(kw));

    // Приоритет категорий (от специфичных к общим)
    let category: TaskCategory = 'general';
    if (isCode)        category = 'coding';
    else if (isMath)   category = 'math';
    else if (isReasoning) category = 'reasoning';
    else if (isResearch)  category = 'research';
    else if (isTranslation) category = 'translation';
    else if (isCreative)    category = 'creative';

    // Оценка сложности
    const isComplex =
      prompt.length > 800 ||
      (isCode && prompt.length > 300) ||
      (isMath && prompt.length > 150) ||
      isReasoning ||
      isResearch;

    const isModerate = !isComplex && (
      prompt.length > 300 ||
      isCode ||
      isMath
    );

    return {
      category,
      complexity: isComplex ? 'complex' : (isModerate ? 'moderate' : 'simple'),
      requiresLongContext: prompt.length > 4000,
      suggestedCapabilities: {
        coding: isCode,
        math: isMath,
        reasoning: isReasoning,
        creative: isCreative,
        translation: isTranslation,
        research: isResearch,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Score-based routing
  // ─────────────────────────────────────────────────────────────

  /**
   * Выбрать наилучшую модель из доступных пользователю с объяснением причины выбора.
   *
   * Алгоритм:
   * 1. Классифицируем задачу (coding / math / reasoning / ...)
   * 2. Для каждой модели считаем score по формуле
   * 3. Модель с наивысшим score побеждает
   * 4. Hard guards (budget exceeded, heavy user) применяются ДО скоринга
   */
  static routeWithReason(
    prompt: string,
    availableModels: ModelRegistryEntry[],
    options?: AutoRouterOptions,
  ): RoutingResult {
    if (availableModels.length === 0) {
      throw new Error('No models available for routing');
    }

    if (availableModels.length === 1) {
      return {
        model: availableModels[0],
        reason: `Default plan model (${availableModels[0].name})`,
      };
    }

    const userPlan = options?.userPlan ?? 'free';
    const monthlyCost = options?.monthlyCost ?? 0;
    const monthlyBudget = options?.monthlyBudget ?? 1; // avoid division by zero
    const isBudgetExceeded = options?.budgetExceeded ?? false;

    // ── HARD GUARD 1: Бюджет исчерпан → бесплатный Qwen 3.8 27B (OpenRouter) ──
    if (isBudgetExceeded || monthlyCost >= monthlyBudget * 0.95) {
      const qwenModel =
        availableModels.find((m) => m.id === 'ketner-mini') ??
        availableModels.find((m) => m.tier === 'free') ??
        availableModels[0];
      return {
        model: qwenModel,
        reason: `Budget exhausted: switched to Qwen 3.8 27B Free (${qwenModel.name}) via OpenRouter`,
      };
    }

    const classification = this.classify(prompt);

    // ── LIGHT REQUESTS: NVIDIA Nemotron 3 Ultra (Free via OpenRouter) ──
    const isLightRequest =
      classification.complexity === 'simple' &&
      prompt.trim().length < 400 &&
      (classification.category === 'general' ||
       classification.category === 'translation' ||
       classification.category === 'creative');

    const nemotron = availableModels.find((m) => m.id === 'nemotron-ultra');
    if (isLightRequest && nemotron) {
      return {
        model: nemotron,
        reason: `Light query optimization: routed to NVIDIA Nemotron 3 Ultra (Free, OpenRouter)`,
      };
    }

    // ── HARD GUARD 2: Free plan — ограничить пул дешёвыми моделями ──
    if (userPlan === 'free') {
      const freeModels = availableModels.filter((m) => m.tier === 'free' || !m.isPro);
      const pool = freeModels.length > 0 ? freeModels : availableModels;
      return this._scoreAndPick(
        prompt, pool, userPlan, monthlyCost / monthlyBudget,
        'Free tier auto-route',
      );
    }

    // ── NORMAL SCORING: все модели конкурируют по score ──
    const budgetRatio = monthlyCost / monthlyBudget;
    return this._scoreAndPick(
      prompt, availableModels, userPlan, budgetRatio,
      'Score-based intelligent routing',
    );
  }

  /**
   * Выбрать наилучшую модель из доступных пользователю.
   */
  static route(
    prompt: string,
    availableModels: ModelRegistryEntry[],
    options?: AutoRouterOptions,
  ): ModelRegistryEntry {
    return this.routeWithReason(prompt, availableModels, options).model;
  }

  // ─────────────────────────────────────────────────────────────
  // Internal: score all models and pick the best
  // ─────────────────────────────────────────────────────────────

  private static _scoreAndPick(
    prompt: string,
    models: ModelRegistryEntry[],
    userPlan: string,
    budgetRatio: number,
    reasonPrefix: string,
  ): RoutingResult {
    const classification = this.classify(prompt);
    const promptLength = prompt.length;

    // Отфильтровать виртуальную модель 'auto'
    const candidates = models.filter((m) => m.id !== 'auto');
    if (candidates.length === 0) {
      return {
        model: models[0],
        reason: `${reasonPrefix}: fallback to ${models[0].name}`,
      };
    }

    // Score каждую модель
    const scores: ModelScore[] = candidates.map((model) => {
      const profile = getProfile(model.id);
      return computeScore(
        model, profile,
        classification.category,
        userPlan,
        budgetRatio,
        promptLength,
      );
    });

    // Сортируем по score DESC
    scores.sort((a, b) => b.score - a.score);

    const winner = scores[0];
    const chosenModel = candidates.find((m) => m.id === winner.modelId)!;

    // Формируем human-readable reason
    const complexityLabel = classification.complexity;
    const categoryLabel = classification.category;
    const reason = `${reasonPrefix}: ${chosenModel.name} ` +
      `(${categoryLabel}/${complexityLabel}, score=${winner.score.toFixed(2)}, ` +
      `plan=${userPlan}, budget=${(budgetRatio * 100).toFixed(0)}%)`;

    return {
      model: chosenModel,
      reason,
      scores,
    };
  }
}
