/**
 * Auto Mode: выбор модели, когда пользователь не указал её сам (режим «Auto»).
 *
 * Правило намеренно простое и предсказуемое. Раньше выбор шёл по числовой оценке с экспертными
 * профилями моделей, и результат нельзя было объяснить пользователю или проверить расчётом.
 * Теперь каждый шаг можно проверить по цене:
 *
 *   Free                         → ketner-mini (Luna): повседневные вопросы стоят ≈ $0.001;
 *   простой вопрос               → ketner-mini (Luna), размышления выключены;
 *   обычная и сложная задача     → ketner-pro (MiMo-V2.6-Pro, открытые веса): уровень флагманов
 *                                  за ≈ $0.005;
 *   математика, логика, код      → glm-5.3 (открытые веса) за ≈ $0.019 из общего бюджета, квоту
 *   средней сложности (Pro, Ultra)  премиум-запросов не тратит;
 *   сложные математика, логика,  → gpt-6.1-sol, пока не исчерпана квота премиум-запросов тарифа,
 *   код (Pro, Ultra)               потом glm-5.3;
 *   бюджет на исходе             → только дешёвые модели.
 *
 * Сложная (`hard`) — не любая задача с кодом или вопросом «почему»: это доказательства, проектирование
 * систем, гонки и утечки, длинные условия, работа с привязанным проектом (AutoRouter.isHard). Раньше
 * на премиум-модель шла любая задача по коду, математике и логике на Pro и Ultra, и квота уходила на
 * «объясни, почему…» и «напиши функцию».
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
import { FLOOR_MODEL_ID, OPEN_FLAGSHIP_MODEL_ID, WORKHORSE_MODEL_ID } from './model-registry.js';
import type { BudgetStage } from '../services/budget-policy.js';

export type AutoComplexity = 'simple' | 'moderate' | 'complex';

export interface AutoRouteInput {
  /** Эффективный тарифный план пользователя. */
  plan: string;
  /** Сложность запроса (учитывает историю, вложения и проект). */
  level: AutoComplexity;
  /** Сложная задача, ради которой стоит тратить квоту премиум-запросов (AutoRouter.isHard). */
  hard?: boolean;
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

/**
 * Категории, где сильная модель заметно лучше рабочей: средние задачи идут на открытую флагманскую,
 * сложные — на премиум-модель.
 */
const STRONG_AUTO_CATEGORIES: ReadonlySet<string> = new Set(['math', 'reasoning', 'coding']);

/** Премиум-модель, которую Auto берёт для сложных задач. */
export const AUTO_PREMIUM_MODEL_ID = 'gpt-6.1-sol';
/** Открытая флагманская модель для задач средней сложности по коду, математике и логике. */
export const AUTO_OPEN_MODEL_ID = OPEN_FLAGSHIP_MODEL_ID;

/** Условие длиннее этого — сложная задача: много вводных, которые надо удержать разом. */
export const HARD_PROMPT_CHARS = 3000;

/**
 * Признаки сложной задачи: доказательства и олимпиадная математика, проектирование систем, отладка
 * конкурентности и утечек, оптимизация алгоритмов, безопасность, компиляторы. «Объясни», «сравни»,
 * «напиши функцию», «найди ошибку» — средняя сложность.
 */
const HARD_TASK_PATTERN = new RegExp(
  [
    'докаж',
    'доказательств',
    'теорем',
    'олимпиад',
    '\\bprove\\b',
    '\\bproof',
    'theorem',
    'olympiad',
    'спроектируй',
    'проектирование систем',
    'system design',
    'design (a|the) (system|service|architecture)',
    'архитектур\\S* (сервиса|системы|приложения|бэкенда|платформы)',
    'распредел[её]нн\\S* (систем|транзакц|блокировк)',
    'distributed (system|transaction|lock)',
    'race condition',
    'состояни\\S* гонки',
    'гонк\\S* данных',
    'deadlock',
    'взаимоблокировк',
    'утечк\\S* памяти',
    'memory leak',
    'оптимизируй (алгоритм|производительность|запрос)',
    'optimi[sz]e (the |this )?(algorithm|performance|query)',
    'асимптотик',
    'time complexity',
    'уязвимост',
    'vulnerabilit',
    'криптограф',
    'cryptograph',
    'компилятор',
    'compiler',
  ].join('|'),
  'i',
);

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
      'теорем',
      'доказательств',
      'докаж',
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
    // Признаки сложной задачи (доказательство, проектирование, гонки, утечки) — тоже рассуждения:
    // «Найди race condition» — не поиск информации.
    const isReasoning =
      reasoningKeywords.some((kw) => text.includes(kw)) || HARD_TASK_PATTERN.test(text);

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
   * Сложная ли задача: такую Auto на Pro и Ultra отдаёт премиум-модели, а не открытой флагманской.
   */
  static isHard(prompt: string): boolean {
    const text = prompt.trim();
    return text.length > HARD_PROMPT_CHARS || HARD_TASK_PATTERN.test(text);
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

    // Pro и Ultra: код, математика и логика идут на сильные модели, пока бюджет не на исходе.
    const strongTask =
      input.level === 'complex' &&
      rank >= planRank('pro') &&
      STRONG_AUTO_CATEGORIES.has(input.category) &&
      input.stage === 'normal' &&
      planAllowsModel(input.plan, 'pro');

    if (strongTask) {
      if (input.hard && input.premiumAvailable) {
        return {
          modelId: AUTO_PREMIUM_MODEL_ID,
          reason: `Auto: hard ${input.category} task, strong model from the premium quota`,
        };
      }
      return {
        modelId: AUTO_OPEN_MODEL_ID,
        reason: input.hard
          ? `Auto: hard ${input.category} task, premium quota used up, open flagship model`
          : `Auto: ${input.category} task of medium difficulty, open flagship model (premium quota saved)`,
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
