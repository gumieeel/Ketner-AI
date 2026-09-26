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
import type { TaskClassification } from './gateway-types.js';

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
  promptModifier?: string;
  reason: string;
  forceCheapMode: boolean;
}

export interface PipelineOptions {
  userPlan?: string;
  monthlyCost?: number;
  monthlyBudget?: number;
  random?: () => number;
}

/**
 * 4. Динамический расчёт выходных токенов (Output Control).
 *
 * maxTokens = Math.floor(baseTokens * tierMultiplier * (1 - budgetPressure))
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
    const dynamicMax = computeDynamicMaxTokens({
      userPlan: tier,
      monthlyCost,
      monthlyBudget,
    });

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
      const cheapModel = classification.category === 'coding' ? 'deepseek-v4.1-flash' : 'nemotron-ultra';
      return {
        tier: 'free',
        mode: 'cheap_direct',
        targetModelId: cheapModel,
        maxOutputTokens: 200,
        reason: `Free tier: cost-optimized via ${cheapModel} (max 200 tokens)`,
        forceCheapMode: false,
      };
    }

    // ── 🔵 PLUS ТАРИФ ($9.99) ──
    // 80% DeepSeek / Qwen
    // 15% DeepSeek + cheap improvement (cheap++)
    // 5% случайный короткий GPT burst
    if (tier === 'plus') {
      const roll = random();

      // 5% GPT burst (короткий ответ под 150 токенов)
      if (roll < 0.05) {
        return {
          tier: 'plus',
          mode: 'gpt_short',
          targetModelId: 'gpt-6-astra',
          maxOutputTokens: 150,
          promptModifier: 'Answer briefly and clearly in under 150 tokens:\n',
          reason: 'Plus tier (5% burst): accelerated flagship GPT-6 Astra short answer',
          forceCheapMode: false,
        };
      }

      // 15% DeepSeek + улучшение (cheap++)
      if (roll < 0.20) {
        return {
          tier: 'plus',
          mode: 'cheap_improve',
          targetModelId: 'deepseek-v4.1-flash',
          draftModelId: 'ketner-mini',
          enhancerModelId: 'deepseek-v4.1-flash',
          maxOutputTokens: 300,
          promptModifier: 'Improve this answer. Make it clearer, structured and concise:\n\n',
          reason: 'Plus tier (15% enhancer): two-pass Qwen draft + DeepSeek V4.1 refinement',
          forceCheapMode: false,
        };
      }

      // 80% Прямой дешёвый ответ (DeepSeek / Nemotron)
      const primary = classification.category === 'coding' ? 'deepseek-v4.1-flash' : 'nemotron-ultra';
      return {
        tier: 'plus',
        mode: 'cheap_direct',
        targetModelId: primary,
        maxOutputTokens: dynamicMax,
        reason: `Plus tier (80% primary): high-speed response via ${primary}`,
        forceCheapMode: false,
      };
    }

    // ── 🟣 PRO ТАРИФ ($19.99) ──
    // 50% cheap + GPT улучшение (gptImprove, max 200)
    // 30% GPT напрямую (короткий: 300 токенов)
    // 20% cheap
    if (tier === 'pro') {
      // Для сложных задач — 30% GPT напрямую
      if (classification.complexity === 'complex') {
        const flagship = classification.category === 'coding' ? 'claude-3.5-sonnet' : 'gpt-6-astra';
        return {
          tier: 'pro',
          mode: 'gpt_full',
          targetModelId: flagship,
          maxOutputTokens: Math.min(dynamicMax, 400),
          reason: `Pro tier (direct flagship): ${flagship} for complex ${classification.category} task`,
          forceCheapMode: false,
        };
      }

      const roll = random();

      // 50% cheap draft + GPT improve
      if (roll < 0.50) {
        return {
          tier: 'pro',
          mode: 'gpt_improve',
          targetModelId: 'gpt-6-astra',
          draftModelId: 'deepseek-v4.1-flash',
          enhancerModelId: 'gpt-6-astra',
          maxOutputTokens: 200,
          promptModifier: 'Improve this answer. Make it clearer, structured and concise:\n\n',
          reason: 'Pro tier (50% optimizer): DeepSeek draft + GPT-6 Astra polish',
          forceCheapMode: false,
        };
      }

      // 30% GPT напрямую
      if (roll < 0.80) {
        return {
          tier: 'pro',
          mode: 'gpt_full',
          targetModelId: 'gpt-6-astra',
          maxOutputTokens: Math.min(dynamicMax, 350),
          reason: 'Pro tier (30% direct): GPT-6 Astra direct generation',
          forceCheapMode: false,
        };
      }

      // 20% Fast flash
      return {
        tier: 'pro',
        mode: 'cheap_direct',
        targetModelId: 'deepseek-v4.1-flash',
        maxOutputTokens: dynamicMax,
        reason: 'Pro tier (20% flash): DeepSeek V4.1 Flash fast delivery',
        forceCheapMode: false,
      };
    }

    // ── 🔴 ULTRA ТАРИФ ($39.99) ──
    // Почти всегда GPT / Claude напрямую с динамическим контролем токенов (до 800)
    const ultraModel = classification.category === 'coding' ? 'claude-3.5-sonnet' : 'gpt-6-astra';
    return {
      tier: 'ultra',
      mode: 'gpt_full',
      targetModelId: ultraModel,
      maxOutputTokens: Math.min(dynamicMax, 800),
      reason: `Ultra tier: full power flagship ${ultraModel} (token-optimized)`,
      forceCheapMode: false,
    };
  }
}
