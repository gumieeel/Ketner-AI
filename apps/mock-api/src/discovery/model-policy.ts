/**
 * Какая модель отвечает на каждом этапе анализа и сколько это может стоить.
 *
 * Решение владельца от 30.10.2026 (docs/discovery-models.md): бесплатный сценарий — GPT-6 Luna,
 * анализ за кредиты — MiMo-V2.6 Pro, «Глубокий анализ» — Claude Sonnet 5.5. Модель этапа не
 * подменяется: шлюз вызывается со `strictModel`.
 *
 * Потолок цены вызова считается до запуска: вход ограничен длиной промпта и полезной нагрузки
 * (prompts.ts, PAYLOAD_LIMITS), выход — `max_tokens` (размышления входят в него). Потолки
 * используются для резерва бесплатного бюджета, проверки баланса и строки «не больше N кредитов».
 */

import type { ReasoningEffort } from '../ai/gateway-types.js';
import { modelRegistry, type ModelRegistry } from '../ai/model-registry.js';
import { CREDITS_PER_USD } from '../services/entitlement.js';
import { OPENROUTER_TOPUP_FEE } from '../services/pricing.js';
import type { Language } from '../types.js';
import {
  contextSystemPrompt,
  discoverySystemPrompt,
  PAYLOAD_LIMITS,
  REPAIR_ECHO_CHARS,
} from './prompts.js';

export type AnalysisMode = 'free' | 'paid' | 'deep';
export type StageName = 'context' | 'discovery' | 'plan';

/** Служебные id каталога; пользователю показывается настоящее имя модели (model-disclosure.ts). */
export const MODEL_BY_MODE: Readonly<Record<AnalysisMode, string>> = {
  free: 'ketner-mini', // GPT-6 Luna
  paid: 'ketner-pro', // MiMo-V2.6 Pro
  deep: 'claude-sonnet-5.5',
};

const OUTPUT_TOKENS: Readonly<Record<AnalysisMode, Readonly<Record<StageName, number>>>> = {
  free: { context: 2_500, discovery: 4_000, plan: 2_000 },
  paid: { context: 2_500, discovery: 4_000, plan: 4_000 },
  deep: { context: 4_000, discovery: 8_000, plan: 6_000 },
};

const EFFORT: Readonly<Record<AnalysisMode, ReasoningEffort>> = {
  free: 'low',
  paid: 'low',
  deep: 'medium',
};

/** Попыток на этап: первая и один повтор при ответе, не прошедшем схему. */
export const STAGE_ATTEMPTS = 2;

/** Полезная нагрузка плана (этап 5): контекст, ответы, выбранная возможность. */
const PLAN_PAYLOAD_CHARS = 10_000;
/** Системный промпт плана ещё не написан (этап 5): запас по длине. */
const PLAN_SYSTEM_CHARS = 5_000;

/**
 * Токенов на символ — с запасом: кириллица ≈ 2.5 символа на токен, латиница ≈ 4. Для потолка берём
 * худший случай (2.2) — реальный вход почти всегда меньше.
 */
const CHARS_PER_TOKEN_WORST = 2.2;
const tokensOf = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN_WORST);

/** Типичный объём этапа (для строки «≈ N кредитов»): вход и выход в токенах. */
const TYPICAL_TOKENS: Readonly<Record<StageName, { input: number; output: number }>> = {
  context: { input: 2_500, output: 2_000 },
  discovery: { input: 4_000, output: 3_500 },
  plan: { input: 4_000, output: 3_300 },
};
const TYPICAL_RETRY_SHARE = 0.1;

export interface StagePolicy {
  modelId: string;
  maxOutputTokens: number;
  reasoningEffort: ReasoningEffort;
  /** Потолок себестоимости этапа со всеми попытками, $. */
  capUsd: number;
  /** Типичная себестоимость этапа, $. */
  typicalUsd: number;
}

function systemChars(stage: StageName, language: Language): number {
  if (stage === 'context') return contextSystemPrompt(language).length;
  if (stage === 'discovery') return discoverySystemPrompt(language).length;
  return PLAN_SYSTEM_CHARS;
}

function payloadChars(stage: StageName): number {
  if (stage === 'context') return PAYLOAD_LIMITS.context;
  if (stage === 'discovery') return PAYLOAD_LIMITS.discovery;
  return PLAN_PAYLOAD_CHARS;
}

function priceUsd(
  pricing: { inputPricePerMillion: number; outputPricePerMillion: number },
  inputTokens: number,
  outputTokens: number,
): number {
  return (
    ((inputTokens * pricing.inputPricePerMillion + outputTokens * pricing.outputPricePerMillion) /
      1_000_000) *
    (1 + OPENROUTER_TOPUP_FEE)
  );
}

export function stagePolicy(
  mode: AnalysisMode,
  stage: StageName,
  language: Language,
  registry: ModelRegistry = modelRegistry,
): StagePolicy {
  const modelId = MODEL_BY_MODE[mode];
  const model = registry.resolve(modelId);
  const maxOutputTokens = Math.min(OUTPUT_TOKENS[mode][stage], model.maxOutputTokens);
  // Служебные строки шлюза (имя модели, обёртка) — небольшой запас сверху.
  const firstInput = tokensOf(systemChars(stage, language) + payloadChars(stage) + 600);
  const retryInput = firstInput + tokensOf(REPAIR_ECHO_CHARS + 600);
  const capUsd =
    priceUsd(model.pricing, firstInput, maxOutputTokens) +
    (STAGE_ATTEMPTS > 1 ? priceUsd(model.pricing, retryInput, maxOutputTokens) : 0);
  const typical = TYPICAL_TOKENS[stage];
  const typicalUsd =
    priceUsd(model.pricing, typical.input, Math.min(typical.output, maxOutputTokens)) *
    (1 + TYPICAL_RETRY_SHARE);
  return {
    modelId,
    maxOutputTokens,
    reasoningEffort: EFFORT[mode],
    capUsd: round6(capUsd),
    typicalUsd: round6(typicalUsd),
  };
}

/** Разбор и поиск возможностей: то, что запускается вместе как «анализ». */
export const ANALYSIS_STAGES: readonly StageName[] = ['context', 'discovery'];

export interface CostEstimate {
  /** Типичная цена, кредиты. */
  typicalCredits: number;
  /** Больше этого не спишется, кредиты. */
  maxCredits: number;
  typicalUsd: number;
  maxUsd: number;
}

export function estimateStages(
  mode: AnalysisMode,
  stages: readonly StageName[],
  language: Language,
  registry: ModelRegistry = modelRegistry,
): CostEstimate {
  let typicalUsd = 0;
  let maxUsd = 0;
  for (const stage of stages) {
    const policy = stagePolicy(mode, stage, language, registry);
    typicalUsd += policy.typicalUsd;
    maxUsd += policy.capUsd;
  }
  return {
    typicalUsd: round6(typicalUsd),
    maxUsd: round6(maxUsd),
    typicalCredits: Math.max(1, Math.round(typicalUsd * CREDITS_PER_USD)),
    maxCredits: Math.ceil(maxUsd * CREDITS_PER_USD),
  };
}

/** Порог, выше которого платная операция требует явного подтверждения (кредиты). */
export const CONFIRM_ABOVE_CREDITS = 50;

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
