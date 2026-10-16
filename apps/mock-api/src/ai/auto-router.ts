/**
 * Auto Mode: выбор модели, когда пользователь не указал её сам (режим «Auto»).
 *
 * Правило намеренно простое и предсказуемое. Раньше выбор шёл по числовой оценке с экспертными
 * профилями моделей, и результат нельзя было объяснить пользователю или проверить расчётом.
 * Теперь каждый шаг можно проверить по цене:
 *
 *   Free                         → ketner-mini (Luna): повседневные вопросы стоят ≈ $0.001;
 *   простой вопрос               → ketner-mini (Luna), размышления выключены;
 *   обычная и сложная задача     → ketner-pro (MiMo-V2.6-Pro): уровень флагманов за ≈ $0.005;
 *   сложная математика, логика,  → gpt-6.1-sol, но только с Pro и выше и пока не исчерпана
 *   код (Pro, Ultra)               квота премиум-запросов тарифа;
 *   бюджет на исходе             → только дешёвые модели.
 *
 * Auto никогда не выбирает класс `top` (Claude Opus): он доступен только по явному выбору
 * пользователя и расходует ту же квоту премиум-запросов.
 *
 * ВАЖНО: AutoRouter используется ТОЛЬКО когда пользователь выбрал 'auto' или не указал модель.
 * Явно выбранная пользователем модель никогда не подменяется «скрытно»: если её приходится
 * заменить (квота премиум-запросов или бюджет), это видно в routingReason и в selectedModel.
 */

import type { TaskCategory, TaskClassification } from './gateway-types.js';
import { planAllowsModel, planRank } from '../services/entitlement.js';
import { FLOOR_MODEL_ID, WORKHORSE_MODEL_ID } from './model-registry.js';
import type { BudgetStage } from '../services/budget-policy.js';

export type AutoComplexity = 'simple' | 'moderate' | 'complex';

export interface AutoRouteInput {
  /** Эффективный тарифный план пользователя. */
  plan: string;
  /** Сложность запроса (учитывает историю, вложения и проект). */
  level: AutoComplexity;
  /** Категория задачи. */
  category: string;
  /** Стадия месячного бюджета пользователя. */
  stage: BudgetStage;
  /** Осталась ли в квоте премиум-запросов тарифа хотя бы небольшая сумма. */
  premiumAvailable: boolean;
}

export interface AutoRouteResult {
  modelId: string;
  reason: string;
}

/** Категории, где сильная модель заметно лучше рабочей: ради них тратится квота премиум-запросов. */
const PREMIUM_AUTO_CATEGORIES: ReadonlySet<string> = new Set(['math', 'reasoning', 'coding']);

/** Премиум-модель, которую Auto берёт для тяжёлых задач. */
export const AUTO_PREMIUM_MODEL_ID = 'gpt-6.1-sol';

export class AutoRouter {
  /**
   * Классифицировать задачу по тексту промпта.
   */
  static classify(prompt: string): TaskClassification {
    const text = prompt.toLowerCase();

    // 1. Кодинг / разработка
    const codeKeywords = [
      'function',
      'const ',
      'let ',
      'var ',
      'class ',
      'import ',
      'export ',
      'def ',
      'return',
      'async',
      'await',
      'interface ',
      'type ',
      'sql',
      'select ',
      'insert ',
      'docker',
      'git ',
      'commit',
      'html',
      'css',
      'javascript',
      'typescript',
      'python',
      'react',
      'vue',
      'баг',
      'ошибка',
      'код',
      'функци',
      'скрипт',
      'рефакторинг',
      'тест',
      'напиши код',
      'исправь',
      'debug',
      'refactor',
      'api',
      'endpoint',
      'component',
      'hook',
      'query',
      'mutation',
      'migration',
      'алгоритм',
      'algorithm',
      'golang',
      'rust',
      ' c++',
      ' java',
      'линтер',
    ];
    const isCode = codeKeywords.some((kw) => text.includes(kw)) || prompt.includes('```');

    // 2. Математика
    const mathKeywords = [
      'вычисли',
      'посчитай',
      'уравнение',
      'интеграл',
      'производная',
      'формула',
      'calculate',
      'solve',
      'equation',
      'integral',
      'derivative',
      'probability',
      'вероятность',
      'матрица',
      'matrix',
      'theorem',
      'теорема',
      'доказательство',
    ];
    const isMath = mathKeywords.some((kw) => text.includes(kw));

    // 3. Рассуждения / глубокий анализ
    const reasoningKeywords = [
      'почему',
      'сравни',
      'проанализируй',
      'в чём разница',
      'архитектура',
      'преимущества и недостатки',
      'why',
      'compare',
      'analyze',
      'difference between',
      'step by step',
      'пошагово',
      'explain',
      'объясни',
      'оцени',
      'pros and cons',
      'trade-offs',
      'рассуди',
    ];
    const isReasoning = reasoningKeywords.some((kw) => text.includes(kw));

    // 4. Перевод
    const translationKeywords = [
      'переведи',
      'перевод',
      'translate',
      'translation',
      'на английский',
      'на русский',
      'to english',
      'to russian',
    ];
    const isTranslation = translationKeywords.some((kw) => text.includes(kw));

    // 5. Креатив / тексты
    const creativeKeywords = [
      'напиши статью',
      'эссе',
      'сочинение',
      'стихотворение',
      'пост',
      'рассказ',
      'write an essay',
      'poem',
      'story',
      'blog post',
      'write a',
      'напиши текст',
      'перепиши',
      'rewrite',
      'summarize',
      'резюмируй',
      'краткое содержание',
    ];
    const isCreative = creativeKeywords.some((kw) => text.includes(kw));

    // 6. Research
    const researchKeywords = [
      'найди',
      'search',
      'research',
      'исследование',
      'обзор',
      'review',
      'survey',
      'state of the art',
    ];
    const isResearch = researchKeywords.some((kw) => text.includes(kw));

    // Приоритет категорий (от специфичных к общим)
    let category: TaskCategory = 'general';
    if (isCode) category = 'coding';
    else if (isMath) category = 'math';
    else if (isReasoning) category = 'reasoning';
    else if (isResearch) category = 'research';
    else if (isTranslation) category = 'translation';
    else if (isCreative) category = 'creative';

    // Оценка сложности
    const isComplex =
      prompt.length > 800 ||
      (isCode && prompt.length > 300) ||
      (isMath && prompt.length > 150) ||
      isReasoning ||
      isResearch;

    const isModerate = !isComplex && (prompt.length > 300 || isCode || isMath);

    return {
      category,
      complexity: isComplex ? 'complex' : isModerate ? 'moderate' : 'simple',
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

  /**
   * Выбрать модель для режима Auto. Результат всегда доступен по тарифу пользователя.
   */
  static route(input: AutoRouteInput): AutoRouteResult {
    if (input.stage === 'exhausted' || input.stage === 'hard_stop') {
      return {
        modelId: FLOOR_MODEL_ID,
        reason: 'Auto: monthly budget exhausted, economy model',
      };
    }

    const rank = planRank(input.plan);

    if (rank < planRank('plus')) {
      return { modelId: FLOOR_MODEL_ID, reason: 'Auto: Free plan, everyday model' };
    }

    if (input.level === 'simple') {
      return { modelId: FLOOR_MODEL_ID, reason: 'Auto: simple query, fast economy model' };
    }

    const wantsPremium =
      input.level === 'complex' &&
      rank >= planRank('pro') &&
      PREMIUM_AUTO_CATEGORIES.has(input.category) &&
      input.premiumAvailable &&
      input.stage === 'normal' &&
      planAllowsModel(input.plan, 'pro');

    if (wantsPremium) {
      return {
        modelId: AUTO_PREMIUM_MODEL_ID,
        reason: `Auto: complex ${input.category} task, strong model from the premium quota`,
      };
    }

    return {
      modelId: WORKHORSE_MODEL_ID,
      reason:
        input.level === 'complex'
          ? 'Auto: complex task, workhorse model'
          : 'Auto: standard task, workhorse model',
    };
  }
}
