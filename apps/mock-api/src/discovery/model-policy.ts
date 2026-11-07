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
  planSystemPrompt,
  REPAIR_ECHO_CHARS,
} from './prompts.js';

import { CATALOG_PROMPT_MAX_CHARS } from '../pricing/catalog.js';

export type AnalysisMode = 'free' | 'paid' | 'deep';
export type StageName = 'context' | 'discovery' | 'plan';

/** Служебные id каталога; пользователю показывается настоящее имя модели (model-disclosure.ts). */
export const MODEL_BY_MODE: Readonly<Record<AnalysisMode, string>> = {
  free: 'ketner-mini', // GPT-6 Luna
  paid: 'ketner-pro', // MiMo-V2.6 Pro
  deep: 'claude-sonnet-5.5',
};

const OUTPUT_TOKENS: Readonly<Record<AnalysisMode, Readonly<Record<StageName, number>>>> = {
  // Поиск возможностей отвечает ещё и работами по внедрению для сметы (pricing/), поэтому
  // потолок ответа выше, чем до сметы (было 4 000 / 4 000 / 8 000).
  free: { context: 2_500, discovery: 5_000, plan: 2_000 },
  paid: { context: 2_500, discovery: 5_000, plan: 4_000 },
  deep: { context: 4_000, discovery: 9_500, plan: 6_000 },
};

const EFFORT: Readonly<Record<AnalysisMode, ReasoningEffort>> = {
  free: 'low',
  paid: 'low',
  deep: 'medium',
};

/** Попыток на этап: первая и один повтор при ответе, не прошедшем схему. */
export const STAGE_ATTEMPTS = 2;

/**
 * Токенов на символ — с запасом: кириллица ≈ 2.5 символа на токен, латиница ≈ 4. Для потолка берём
 * худший случай (2.2) — реальный вход почти всегда меньше.
 */
const CHARS_PER_TOKEN_WORST = 2.2;
const tokensOf = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN_WORST);

/** Типичный объём этапа (для строки «≈ N кредитов»): вход и выход в токенах. */
const TYPICAL_TOKENS: Readonly<Record<StageName, { input: number; output: number }>> = {
  context: { input: 2_500, output: 2_000 },
  discovery: { input: 5_000, output: 4_300 },
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
  // Каталог работ меняет администратор: для потолка цены берём его наибольший допустимый размер.
  if (stage === 'discovery')
    return discoverySystemPrompt(language, '').length + CATALOG_PROMPT_MAX_CHARS;
  // Бесплатный план — краткий, за кредиты — полный (промпт чуть длиннее, считаем по нему).
  return planSystemPrompt(language, 'full').length;
}

function payloadChars(stage: StageName): number {
  if (stage === 'context') return PAYLOAD_LIMITS.context;
  if (stage === 'discovery') return PAYLOAD_LIMITS.discovery;
  return PAYLOAD_LIMITS.plan;
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

/**
 * Потолок и типичная цена одного служебного вызова вне этапов анализа (Builder: черновик
 * помощника, судья тест-кейса, ответ помощника в тесте) — по той же формуле, что этапы.
 */
export function callCost(
  modelId: string,
  input: { systemChars: number; payloadChars: number; maxOutputTokens: number; attempts: number },
  typical: { inputTokens: number; outputTokens: number },
  registry: ModelRegistry = modelRegistry,
): { capUsd: number; typicalUsd: number; maxOutputTokens: number } {
  const model = registry.resolve(modelId);
  const maxOutputTokens = Math.min(input.maxOutputTokens, model.maxOutputTokens);
  const firstInput = tokensOf(input.systemChars + input.payloadChars + 600);
  const retryInput = firstInput + tokensOf(REPAIR_ECHO_CHARS + 600);
  let capUsd = priceUsd(model.pricing, firstInput, maxOutputTokens);
  if (input.attempts > 1) capUsd += priceUsd(model.pricing, retryInput, maxOutputTokens);
  const typicalUsd =
    priceUsd(model.pricing, typical.inputTokens, Math.min(typical.outputTokens, maxOutputTokens)) *
    (input.attempts > 1 ? 1 + TYPICAL_RETRY_SHARE : 1);
  return { capUsd: round6(capUsd), typicalUsd: round6(typicalUsd), maxOutputTokens };
}

/** Кредиты из долларов: ≈ — округление, «не больше» — вверх. */
export function toCreditRange(typicalUsd: number, capUsd: number) {
  return {
    typicalCredits: Math.max(1, Math.round(typicalUsd * CREDITS_PER_USD)),
    maxCredits: Math.ceil(capUsd * CREDITS_PER_USD),
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
