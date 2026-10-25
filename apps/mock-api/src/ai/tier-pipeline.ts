/**
 * Tier Pipeline Engine — экономика токенов и пайплайны по тарифам.
 *
 * Главные принципы:
 * 1. Output токены стоят в 3–5 раз дороже input: главный враг — длинные ответы.
 * 2. GPT / Claude — только для Pro / Ultra (или редкий burst в Plus).
 * 3. Plus работает на дешёвых моделях (DeepSeek / Qwen / Nemotron), но ощущается как топовый AI.
 * 4. Dynamic maxTokens = baseTokens * tierMultiplier * (1 - budgetPressure).
 * 5. Double Pass: дешевая модель делает черновик, флагман лишь улучшает/структурирует.
 * 6. Бюджетный триггер: при расходе > 80% бюджета принудительно forceCheapMode (max 200 токенов).
 */

import { AutoRouter } from './auto-router.js';
import { modelRegistry, type ModelRegistry } from './model-registry.js';
import type { TaskClassification } from './gateway-types.js';
import type { Language } from '../types.js';

export const SHORT_ANSWER_PROMPT: Record<Language, string> = {
  ru: 'Ответь кратко и чётко (до 150 токенов):\n',
  en: 'Answer briefly and clearly in under 150 tokens:\n',
};

export const REFINE_ANSWER_PROMPT: Record<Language, string> = {
  ru: 'Улучши этот ответ. Сделай его более чётким, структурированным и лаконичным:\n\n',
  en: 'Improve this answer. Make it clearer, structured and concise:\n\n',
};

export type PipelineMode =
  | 'cheap_direct'
  | 'cheap_improve'
  | 'gpt_short'
  | 'gpt_improve'
  | 'gpt_full';

export interface PipelineStrategy {
  tier: 'free' | 'plus' | 'pro' | 'ultra';
  mode: PipelineMode;
  targetModelId: string;
  draftModelId?: string;
  enhancerModelId?: string;
  maxOutputTokens: number;
  promptModifier?: Record<Language, string> | string;
  reason: string;
  forceCheapMode: boolean;
}

export interface PipelineOptions {
  userPlan?: string;
  monthlyCost?: number;
  monthlyBudget?: number;
  random?: () => number;
  registry?: ModelRegistry;
}

/**
 * Phase 2: базовые токены по категории задачи.
 *
 * Краткость регулируется промптом; жёсткий лимит — предохранитель.
 *   simple / general   → 300–400 токенов
 *   creative / translation → 1500 токенов
 *   coding / reasoning → 2500 токенов
 *   math / research    → 3000 токенов
 */
export function computeBaseTokensByCategory(category: string): number {
  switch (category) {
    case 'coding':
    case 'reasoning':
      return 2500;
    case 'math':
    case 'research':
      return 3000;
    case 'creative':
    case 'translation':
      return 1500;
    default:
      return 300;
  }
}

/**
 * 4. Динамический расчёт выходных токенов (Output Control).
 *
 * maxTokens = Math.floor(baseTokens * tierMultiplier * (1 - budgetPressure))
 *
 * Phase 2: baseTokens теперь приходит из computeBaseTokensByCategory,
 * а не фиксированные 300. Это убирает ситуацию, когда ответ с кодом
 * обрывался на 300 токенах.
 */
export function computeDynamicMaxTokens(options: {
  userPlan: string;
  monthlyCost: number;
  monthlyBudget: number;
  baseTokens?: number;
}): number {
  const base = options.baseTokens ?? 300;

  const tierMultiplier: Record<string, number> = {
    free: 0.7,
    plus: 1.0,
    pro: 1.5,
    ultra: 2.5,
    // legacy
    'gpt-pro': 1.5,
    'claude-pro': 1.5,
    'gemini-pro': 1.5,
  };

  const mult = tierMultiplier[options.userPlan] ?? 1.0;
  const budgetRatio = options.monthlyBudget > 0 ? options.monthlyCost / options.monthlyBudget : 0;

  // 8. Бюджетный триггер: при расходе > 80% лимита жесткий лимит 200 токенов
  if (budgetRatio >= 0.8) {
    return 200;
  }

  const budgetPressure = Math.min(Math.max(budgetRatio, 0), 0.75);
  const calculated = Math.floor(base * mult * (1 - budgetPressure));

  return Math.max(options.userPlan === 'free' ? 150 : 200, calculated);
}

/**
 * Эвристика проверки низкого качества черновика.
 */
export function isLowQuality(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 50) return true;
  if (trimmed.includes('error') || trimmed.includes('undefined') || trimmed.includes('I cannot')) {
    return true;
  }
  return false;
}

export class TierPipelineEngine {
  /**
   * Разрешить стратегию исполнения запроса в соответствии с тарифом и экономикой токенов.
   */
  static resolveStrategy(prompt: string, options?: PipelineOptions): PipelineStrategy {
    const rawPlan = options?.userPlan ?? 'free';
    const monthlyCost = options?.monthlyCost ?? 0;
    const monthlyBudget = options?.monthlyBudget ?? 1;
    const random = options?.random ?? Math.random;

    let tier: 'free' | 'plus' | 'pro' | 'ultra' = 'free';
    if (rawPlan === 'ultra') tier = 'ultra';
    else if (rawPlan === 'pro' || rawPlan === 'gpt-pro' || rawPlan === 'claude-pro' || rawPlan === 'gemini-pro') {
      tier = 'pro';
    } else if (rawPlan === 'plus') {
      tier = 'plus';
    }

    const budgetRatio = monthlyBudget > 0 ? monthlyCost / monthlyBudget : 0;
    const forceCheapMode = budgetRatio >= 0.8;

    const classification: TaskClassification = AutoRouter.classify(prompt);

    // Phase 2: базовые токены по категории задачи
    const baseTokens = computeBaseTokensByCategory(classification.category);
    const dynamicMax = computeDynamicMaxTokens({
      userPlan: tier,
      monthlyCost,
      monthlyBudget,
      baseTokens,
    });

    const registry = options?.registry ?? modelRegistry;
    const cheapCandidates = registry
      .getForPlan('free')
      .filter((m) => m.id !== 'auto');
    const flagshipCandidates = registry
      .getAll()
      .filter(
        (m) =>
          (m.tier === 'flagship' ||
            m.id === 'gpt-6-astra' ||
            m.id === 'claude-3.5-sonnet' ||
            m.id === 'gemini-2.5-pro') &&
          m.id !== 'auto',
      );

    // ── БЮДЖЕТНЫЙ ТРИГГЕР: расход > 80% бюджета ──
    if (forceCheapMode) {
      return {
        tier,
        mode: 'cheap_direct',
        targetModelId: 'ketner-mini',
        maxOutputTokens: 200,
        reason: 'Budget pressure (>80%): switched to zero-cost Qwen 3.8 27B with 200 token cap',
        forceCheapMode: true,
      };
    }

    // ── 🟢 FREE ТАРИФ ──
    // 100% дешёвые модели, короткие ответы (max 200 токенов), агрессивное сжатие
    if (tier === 'free') {
      const routed = AutoRouter.routeWithReason(prompt, cheapCandidates, {
        userPlan: 'free',
        monthlyCost,
        monthlyBudget,
      });
      return {
        tier: 'free',
        mode: 'cheap_direct',
        targetModelId: routed.model.id,
        maxOutputTokens: 200,
        reason: `Free tier: ${routed.reason} (max 200 tokens)`,
        forceCheapMode: false,
      };
    }

    // ── 🔵 PLUS ТАРИФ ($9.99) ──
    // Phase 2: детерминированное правило вместо random():
    //   - код / reasoning / moderate → cheap_improve (DeepSeek черновик + улучшение)
    //   - simple → cheap_direct
    //   - 5% GPT burst оставляем только для explicit-запросов
    if (tier === 'plus') {
      const roll = random();

      // 5% GPT burst (короткий ответ под 150 токенов)
      if (roll < 0.05) {
        const burstModel = AutoRouter.routeWithReason(prompt, flagshipCandidates, {
          userPlan: 'plus',
          monthlyCost,
          monthlyBudget,
        });
        return {
          tier: 'plus',
          mode: 'gpt_short',
          targetModelId: burstModel.model.id,
          maxOutputTokens: 150,
          promptModifier: SHORT_ANSWER_PROMPT,
          reason: `Plus tier (5% burst): accelerated flagship ${burstModel.model.name} short answer`,
          forceCheapMode: false,
        };
      }

      // Phase 2: детерминированная маршрутизация по сложности
      // Код, рассуждения, умеренные задачи → cheap_improve (двухпроходный)
      const isComplexForPlus =
        classification.complexity === 'complex' ||
        classification.complexity === 'moderate' ||
        classification.category === 'coding' ||
        classification.category === 'reasoning' ||
        classification.category === 'math' ||
        classification.category === 'research';

      if (roll < 0.20 || isComplexForPlus) {
        return {
          tier: 'plus',
          mode: 'cheap_improve',
          targetModelId: 'deepseek-v4.1-flash',
          draftModelId: 'ketner-mini',
          enhancerModelId: 'deepseek-v4.1-flash',
          maxOutputTokens: Math.min(dynamicMax, 800),
          promptModifier: REFINE_ANSWER_PROMPT,
          reason: isComplexForPlus
            ? 'Plus tier (complex/moderate): two-pass Qwen draft + DeepSeek V4.1 refinement'
            : 'Plus tier (15% enhancer): two-pass Qwen draft + DeepSeek V4.1 refinement',
          forceCheapMode: false,
        };
      }

      // simple → cheap_direct (по скорингу)
      const routed = AutoRouter.routeWithReason(prompt, cheapCandidates, {
        userPlan: 'plus',
        monthlyCost,
        monthlyBudget,
      });
      return {
        tier: 'plus',
        mode: 'cheap_direct',
        targetModelId: routed.model.id,
        maxOutputTokens: dynamicMax,
        reason: `Plus tier (simple): ${routed.reason}`,
        forceCheapMode: false,
      };
    }

    // ── 🟣 PRO ТАРИФ ($19.99) ──
    // 50% cheap + GPT улучшение (gptImprove, max 200)
    // 30% GPT напрямую (короткий: 350 токенов)
    // 20% cheap
    if (tier === 'pro') {
      // Для сложных задач — GPT/Claude напрямую через скоринг флагманов
      if (classification.complexity === 'complex') {
        const routedFlagship = AutoRouter.routeWithReason(prompt, flagshipCandidates, {
          userPlan: 'pro',
          monthlyCost,
          monthlyBudget,
        });
        return {
          tier: 'pro',
          mode: 'gpt_full',
          targetModelId: routedFlagship.model.id,
          maxOutputTokens: Math.min(dynamicMax, 400),
          reason: `Pro tier (direct flagship): ${routedFlagship.reason}`,
          forceCheapMode: false,
        };
      }

      const roll = random();

      // 50% cheap draft + GPT improve
      if (roll < 0.50) {
        const routedFlagship = AutoRouter.routeWithReason(prompt, flagshipCandidates, {
          userPlan: 'pro',
          monthlyCost,
          monthlyBudget,
        });
        return {
          tier: 'pro',
          mode: 'gpt_improve',
          targetModelId: routedFlagship.model.id,
          draftModelId: 'deepseek-v4.1-flash',
          enhancerModelId: routedFlagship.model.id,
          maxOutputTokens: 200,
          promptModifier: REFINE_ANSWER_PROMPT,
          reason: `Pro tier (50% optimizer): DeepSeek draft + ${routedFlagship.model.name} polish`,
          forceCheapMode: false,
        };
      }

      // 30% GPT напрямую по скорингу флагманов
      if (roll < 0.80) {
        const routedFlagship = AutoRouter.routeWithReason(prompt, flagshipCandidates, {
          userPlan: 'pro',
          monthlyCost,
          monthlyBudget,
        });
        return {
          tier: 'pro',
          mode: 'gpt_full',
          targetModelId: routedFlagship.model.id,
          maxOutputTokens: Math.min(dynamicMax, 350),
          reason: `Pro tier (30% direct): ${routedFlagship.reason}`,
          forceCheapMode: false,
        };
      }

      // 20% Fast flash по скорингу дешёвых моделей
      const routedCheap = AutoRouter.routeWithReason(prompt, cheapCandidates, {
        userPlan: 'pro',
        monthlyCost,
        monthlyBudget,
      });
      return {
        tier: 'pro',
        mode: 'cheap_direct',
        targetModelId: routedCheap.model.id,
        maxOutputTokens: dynamicMax,
        reason: `Pro tier (20% flash): ${routedCheap.reason}`,
        forceCheapMode: false,
      };
    }

    // ── 🔴 ULTRA ТАРИФ ($39.99) ──
    // Флагман напрямую со скорингом лучших моделей под задачу
    const routedUltra = AutoRouter.routeWithReason(prompt, flagshipCandidates, {
      userPlan: 'ultra',
      monthlyCost,
      monthlyBudget,
    });
    return {
      tier: 'ultra',
      mode: 'gpt_full',
      targetModelId: routedUltra.model.id,
      maxOutputTokens: Math.min(dynamicMax, 800),
      reason: `Ultra tier: ${routedUltra.reason}`,
      forceCheapMode: false,
    };
  }
}
