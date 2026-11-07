/**
 * Pricing & Complexity Engine: детерминированная смета внедрения.
 *
 * Вход — работы, которые назвала модель (id из каталога, количество, ярлык сложности, причина),
 * неизвестные и допущения возможности, сигналы профиля бизнеса. Всё, что влияет на деньги и сроки,
 * берётся из каталога и настроек; от модели — только выбор работ и ярлык сложности, который
 * приводится в допустимый для работы диапазон. Формулы — в docs/BUSINESS_DISCOVERY_PRICING_PLAN.md,
 * раздел «Методика».
 */

import {
  COMPLEXITIES,
  isPriced,
  sharedItems,
  type CatalogItem,
  type Complexity,
  type PricingConfig,
  type SolutionType,
} from './catalog.js';
import { ceilTo, mulDiv, toBasisPoints, toCentiHours, toMilli } from './money.js';

export interface WorkItemInput {
  capability: string;
  quantity: number;
  /** Ярлык модели; null — модель не назвала. */
  complexity: Complexity | null;
  reason: string;
}

export interface OpportunityInput {
  id: string;
  title: string;
  solutionType: SolutionType;
  workItems: WorkItemInput[];
  unknowns: string[];
  assumptions: string[];
  /** Работы выведены сервером из требований платформы, а не названы моделью. */
  derived: boolean;
}

/** Что известно о бизнесе: влияет на уверенность и разброс, а не на часы. */
export interface ProfileSignals {
  /** Обращений или заказов в месяц со слов человека; null — неизвестно. */
  monthlyRequests: number | null;
  /** Чего не хватает в профиле (для объяснения и уверенности). */
  missing: string[];
}

export type Confidence = 'low' | 'medium' | 'high';

export interface Range {
  min: number;
  expected: number;
  max: number;
}

export interface EstimateLine {
  capabilityId: string;
  name: { ru: string; en: string };
  category: CatalogItem['category'];
  status: CatalogItem['status'];
  quantity: number;
  /** Сложность после проверки по каталогу. */
  complexity: Complexity;
  /** Что предложила модель (null — не назвала). */
  requestedComplexity: Complexity | null;
  /** Множитель сложности, тысячные. */
  multiplierMilli: number;
  /** Часы, центичасы. */
  hours: Range;
  /** Работа, ₸. */
  laborKzt: Range;
  /** Прямые расходы, ₸; null — неизвестны. */
  directCostKzt: number | null;
  requiresManualReview: boolean;
  /** Работа общая для нескольких возможностей (в общей смете посчитана один раз). */
  sharedBy: string[];
  /** Работа проекта (подготовка, запуск), не из ответа модели. */
  projectTask: boolean;
  reasons: string[];
  includes: string[];
  exclusions: string[];
  prerequisites: string[];
  externalLeadDays: [number, number];
}

export interface ExcludedWork {
  capabilityId: string;
  name: string | null;
  reason: 'unknown_capability' | 'not_offered';
  opportunityIds: string[];
  note: string;
}

export interface EstimateResult {
  scope: 'opportunity' | 'combined';
  opportunityIds: string[];
  solutionTypes: SolutionType[];
  lines: EstimateLine[];
  excluded: ExcludedWork[];
  /** Тестирование, центичасы. */
  testingHours: Range;
  /** Итого часов, центичасы (максимум — с расширением на неопределённость). */
  hours: Range;
  /** Расширение максимума на неопределённость, базисные пункты. */
  uncertaintyBp: number;
  laborKzt: Range;
  directKzt: number;
  /** Работы с неизвестными прямыми расходами. */
  unknownDirectCosts: string[];
  /** Резерв на риски (у минимума нет). */
  riskReserveKzt: Range;
  /** До минимальной цены и округления. */
  rawTotalKzt: Range;
  /** Итог для клиента; null — посчитать нельзя (ничего из каталога не подходит). */
  priceKzt: Range | null;
  minimumApplied: boolean;
  duration: { workingDaysMin: number; workingDaysMax: number; externalApproval: boolean };
  confidence: Confidence;
  confidenceReasons: string[];
  assumptions: string[];
  unknowns: string[];
  exclusions: string[];
  requiresManualReview: boolean;
  technicalVerificationRequired: boolean;
  derivedWorkItems: boolean;
  /** Сумма ожидаемых цен отдельных смет минус общая (только у общей сметы). */
  sharedSavingsKzt: number | null;
  /** Параметры, по которым посчитано (для воспроизведения и проверки администратором). */
  parameters: {
    billableHourlyRateKzt: number;
    multipliersMilli: Record<Complexity, number>;
    riskReserveBp: number;
    testingBp: number;
    uncertaintyPerUnknownBp: number;
    uncertaintyMaxBp: number;
    minimumImplementationPriceKzt: number;
    roundingIncrementKzt: number;
    workingHoursPerDay: number;
    customerFeedbackDays: [number, number];
  };
}

const RANK: Record<Complexity, number> = { simple: 0, medium: 1, complex: 2 };

/** Ярлык модели → допустимая сложность работы (из каталога). */
export function validateComplexity(item: CatalogItem, requested: Complexity | null): Complexity {
  const value = requested ?? item.defaultComplexity;
  const [low, high] = item.complexityRange;
  if (RANK[value] < RANK[low]) return low;
  if (RANK[value] > RANK[high]) return high;
  return value;
}

function clampQuantity(item: CatalogItem, quantity: number): number {
  if (!Number.isFinite(quantity) || quantity < 1) return 1;
  return Math.min(Math.floor(quantity), item.maxQuantity);
}

interface MergedWork {
  item: CatalogItem;
  quantity: number;
  requested: Complexity | null;
  complexity: Complexity;
  reasons: string[];
  opportunityIds: string[];
}

function uniq(values: readonly string[], max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Смета по одной или нескольким возможностям. Одинаковые работы разных возможностей считаются
 * один раз (наибольшее количество и сложность), подготовка и запуск — один раз на проект.
 */
export function estimate(
  opportunities: readonly OpportunityInput[],
  catalog: readonly CatalogItem[],
  config: PricingConfig,
  profile: ProfileSignals,
  language: 'ru' | 'en' = 'ru',
): EstimateResult {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const merged = new Map<string, MergedWork>();
  const excluded = new Map<string, ExcludedWork>();

  for (const opportunity of opportunities) {
    for (const work of opportunity.workItems) {
      const item = byId.get(work.capability);
      if (!item || item.category === 'shared') {
        const key = `unknown:${work.capability}`;
        const entry = excluded.get(key) ?? {
          capabilityId: work.capability,
          name: null,
          reason: 'unknown_capability' as const,
          opportunityIds: [],
          note: work.reason,
        };
        if (!entry.opportunityIds.includes(opportunity.id))
          entry.opportunityIds.push(opportunity.id);
        excluded.set(key, entry);
        continue;
      }
      if (!isPriced(item)) {
        const entry = excluded.get(item.id) ?? {
          capabilityId: item.id,
          name: item.name[language],
          reason: 'not_offered' as const,
          opportunityIds: [],
          note: item.description[language],
        };
        if (!entry.opportunityIds.includes(opportunity.id))
          entry.opportunityIds.push(opportunity.id);
        excluded.set(item.id, entry);
        continue;
      }
      const quantity = clampQuantity(item, work.quantity);
      const complexity = validateComplexity(item, work.complexity);
      const current = merged.get(item.id);
      if (!current) {
        merged.set(item.id, {
          item,
          quantity,
          requested: work.complexity,
          complexity,
          reasons: work.reason ? [work.reason] : [],
          opportunityIds: [opportunity.id],
        });
        continue;
      }
      // Общая работа: считаем один раз — по самому большому объёму и сложности.
      current.quantity = Math.max(current.quantity, quantity);
      if (RANK[complexity] > RANK[current.complexity]) {
        current.complexity = complexity;
        current.requested = work.complexity;
      }
      if (work.reason) current.reasons.push(work.reason);
      if (!current.opportunityIds.includes(opportunity.id))
        current.opportunityIds.push(opportunity.id);
    }
  }

  const multipliersMilli: Record<Complexity, number> = {
    simple: toMilli(config.complexityMultipliers.simple),
    medium: toMilli(config.complexityMultipliers.medium),
    complex: toMilli(config.complexityMultipliers.complex),
  };
  const rate = config.billableHourlyRateKzt;
  const labor = (centi: number) => mulDiv(centi, rate, 100);

  const lineOf = (work: MergedWork, projectTask: boolean): EstimateLine => {
    const multiplier = multipliersMilli[work.complexity];
    const scale = (hours: number) => mulDiv(toCentiHours(hours) * work.quantity, multiplier, 1000);
    const hours: Range = {
      min: scale(work.item.hoursMin),
      expected: scale(work.item.hoursExpected),
      max: scale(work.item.hoursMax),
    };
    return {
      capabilityId: work.item.id,
      name: work.item.name,
      category: work.item.category,
      status: work.item.status,
      quantity: work.quantity,
      complexity: work.complexity,
      requestedComplexity: work.requested,
      multiplierMilli: multiplier,
      hours,
      laborKzt: { min: labor(hours.min), expected: labor(hours.expected), max: labor(hours.max) },
      directCostKzt:
        work.item.directSetupCostKzt === null ? null : work.item.directSetupCostKzt * work.quantity,
      requiresManualReview: work.item.requiresManualReview,
      sharedBy: work.opportunityIds.length > 1 ? [...work.opportunityIds] : [],
      projectTask,
      reasons: uniq(work.reasons, 4),
      includes: work.item.includes,
      exclusions: work.item.exclusions,
      prerequisites: work.item.prerequisites,
      externalLeadDays: work.item.externalLeadDays,
    };
  };

  const workLines = [...merged.values()].map((work) => lineOf(work, false));
  const priced = workLines.length > 0;
  const projectLines = priced
    ? sharedItems(catalog).map((item) =>
        lineOf(
          {
            item,
            quantity: 1,
            requested: null,
            complexity: item.defaultComplexity,
            reasons: [],
            opportunityIds: opportunities.map((o) => o.id),
          },
          true,
        ),
      )
    : [];
  const lines = [...workLines, ...projectLines];

  const sum = (key: keyof Range, list: readonly EstimateLine[]) =>
    list.reduce((total, line) => total + line.hours[key], 0);
  const testingBp = toBasisPoints(config.testingPercent);
  const testingHours: Range = {
    min: mulDiv(sum('min', workLines), testingBp, 10_000),
    expected: mulDiv(sum('expected', workLines), testingBp, 10_000),
    max: mulDiv(sum('max', workLines), testingBp, 10_000),
  };

  const unknowns = uniq(opportunities.flatMap((o) => o.unknowns));
  const assumptions = uniq(opportunities.flatMap((o) => o.assumptions));
  const derived = opportunities.some((o) => o.derived);
  const reviewLines = workLines.filter((line) => line.requiresManualReview);
  const aiInvolved = workLines.some((line) => line.category === 'ai');
  const volumeUnknown = aiInvolved && profile.monthlyRequests === null;

  // Неопределённость: каждая неизвестная, работа на проверке и неизвестный объём расширяют
  // только максимум (ожидаемая оценка — без этого, чтобы риск не считался дважды с резервом).
  const uncertaintyCount = unknowns.length + reviewLines.length + (volumeUnknown ? 1 : 0);
  const uncertaintyBp = Math.min(
    toBasisPoints(config.uncertaintyMaxPercent),
    uncertaintyCount * toBasisPoints(config.uncertaintyPercentPerUnknown),
  );

  const rawHours: Range = {
    min: sum('min', lines) + testingHours.min,
    expected: sum('expected', lines) + testingHours.expected,
    max: sum('max', lines) + testingHours.max,
  };
  const hours: Range = {
    ...rawHours,
    max: mulDiv(rawHours.max, 10_000 + uncertaintyBp, 10_000),
  };

  const directKzt = lines.reduce((total, line) => total + (line.directCostKzt ?? 0), 0);
  const unknownDirectCosts = lines
    .filter((line) => line.directCostKzt === null)
    .map((line) => line.name[language]);

  const laborKzt: Range = {
    min: labor(hours.min),
    expected: labor(hours.expected),
    max: labor(hours.max),
  };
  const riskBp = toBasisPoints(config.riskReservePercent);
  const subtotal: Range = {
    min: laborKzt.min + directKzt,
    expected: laborKzt.expected + directKzt,
    max: laborKzt.max + directKzt,
  };
  const riskReserveKzt: Range = {
    min: 0,
    expected: mulDiv(subtotal.expected, riskBp, 10_000),
    max: mulDiv(subtotal.max, riskBp, 10_000),
  };
  const rawTotalKzt: Range = {
    min: subtotal.min,
    expected: subtotal.expected + riskReserveKzt.expected,
    max: subtotal.max + riskReserveKzt.max,
  };

  let priceKzt: Range | null = null;
  let minimumApplied = false;
  if (priced) {
    const floor = config.minimumImplementationPriceKzt;
    const step = config.roundingIncrementKzt;
    const finalize = (value: number) => {
      if (value < floor) minimumApplied = true;
      return ceilTo(Math.max(value, floor), step);
    };
    const min = finalize(rawTotalKzt.min);
    const expected = Math.max(min, finalize(rawTotalKzt.expected));
    const max = Math.max(expected, finalize(rawTotalKzt.max));
    priceKzt = { min, expected, max };
  }

  const capacity = Math.max(1, toCentiHours(config.workingHoursPerDay));
  const lead = workLines.reduce<[number, number]>(
    (acc, line) => [
      Math.max(acc[0], line.externalLeadDays[0]),
      Math.max(acc[1], line.externalLeadDays[1]),
    ],
    [0, 0],
  );
  const workingDaysMin = priced
    ? Math.max(1, Math.ceil(hours.min / capacity)) + config.customerFeedbackDays[0] + lead[0]
    : 0;
  const workingDaysMax = priced
    ? Math.max(1, Math.ceil(hours.max / capacity)) + config.customerFeedbackDays[1] + lead[1]
    : 0;

  const excludedList = [...excluded.values()];
  const confidenceReasons: string[] = [];
  if (!priced) confidenceReasons.push('no_priced_work');
  if (excludedList.some((e) => e.reason === 'not_offered'))
    confidenceReasons.push('not_offered_work');
  if (excludedList.some((e) => e.reason === 'unknown_capability'))
    confidenceReasons.push('unknown_work');
  if (derived) confidenceReasons.push('derived_work_items');
  if (reviewLines.length > 0) confidenceReasons.push('manual_review_work');
  if (unknowns.length > 0) confidenceReasons.push('unknowns');
  if (volumeUnknown) confidenceReasons.push('volume_unknown');
  if (profile.missing.length > 0) confidenceReasons.push('profile_incomplete');

  const low = !priced || excludedList.length > 0 || derived || unknowns.length >= 3;
  const medium =
    reviewLines.length > 0 || unknowns.length > 0 || volumeUnknown || profile.missing.length > 0;
  const confidence: Confidence = low ? 'low' : medium ? 'medium' : 'high';

  const requiresManualReview = !priced || excludedList.length > 0 || reviewLines.length > 0;

  return {
    scope: opportunities.length > 1 ? 'combined' : 'opportunity',
    opportunityIds: opportunities.map((o) => o.id),
    solutionTypes: [...new Set(opportunities.map((o) => o.solutionType))],
    lines,
    excluded: excludedList,
    testingHours,
    hours,
    uncertaintyBp,
    laborKzt,
    directKzt,
    unknownDirectCosts,
    riskReserveKzt,
    rawTotalKzt,
    priceKzt,
    minimumApplied,
    duration: { workingDaysMin, workingDaysMax, externalApproval: lead[1] > 0 },
    confidence,
    confidenceReasons,
    assumptions,
    unknowns,
    exclusions: uniq(lines.flatMap((line) => line.exclusions)),
    requiresManualReview,
    technicalVerificationRequired: requiresManualReview || derived,
    derivedWorkItems: derived,
    sharedSavingsKzt: null,
    parameters: {
      billableHourlyRateKzt: rate,
      multipliersMilli,
      riskReserveBp: riskBp,
      testingBp,
      uncertaintyPerUnknownBp: toBasisPoints(config.uncertaintyPercentPerUnknown),
      uncertaintyMaxBp: toBasisPoints(config.uncertaintyMaxPercent),
      minimumImplementationPriceKzt: config.minimumImplementationPriceKzt,
      roundingIncrementKzt: config.roundingIncrementKzt,
      workingHoursPerDay: config.workingHoursPerDay,
      customerFeedbackDays: config.customerFeedbackDays,
    },
  };
}

/**
 * Общая смета нескольких возможностей и экономия относительно покупки по отдельности
 * (общие подключения, подготовка и запуск — один раз).
 */
export function combinedEstimate(
  opportunities: readonly OpportunityInput[],
  individual: readonly EstimateResult[],
  catalog: readonly CatalogItem[],
  config: PricingConfig,
  profile: ProfileSignals,
  language: 'ru' | 'en' = 'ru',
): EstimateResult {
  const result = estimate(opportunities, catalog, config, profile, language);
  const separate = individual.reduce<number | null>(
    (total, item) => (total === null || !item.priceKzt ? null : total + item.priceKzt.expected),
    0,
  );
  result.scope = 'combined';
  result.sharedSavingsKzt =
    separate !== null && result.priceKzt ? Math.max(0, separate - result.priceKzt.expected) : null;
  return result;
}

/**
 * Работы по требованиям платформы, если модель не назвала работы (анализы до этой версии или
 * обрезанный ответ). Только явные соответствия; уверенность такой сметы — низкая.
 */
const DERIVED: Record<string, string | null> = {
  text_generation: 'ai_message_processing',
  document_text: 'ai_document_processing',
  document_tools: 'ai_document_processing',
  pdf_reading: 'ai_document_processing',
  messengers: 'telegram_integration',
  crm: 'crm_integration',
  spreadsheets_sync: 'google_sheets_integration',
  email: 'email_integration',
  external_actions: 'webhook_integration',
  scheduled_runs: 'workflow_branching',
};

export function deriveWorkItems(requires: readonly string[]): WorkItemInput[] {
  const out: WorkItemInput[] = [];
  for (const id of requires) {
    const capability = DERIVED[id];
    if (capability === undefined) continue;
    if (capability && !out.some((item) => item.capability === capability)) {
      out.push({ capability, quantity: 1, complexity: null, reason: '' });
    }
  }
  return out;
}

/** Нормализация ярлыка сложности из произвольного ввода. */
export function asComplexity(value: unknown): Complexity | null {
  return typeof value === 'string' && (COMPLEXITIES as readonly string[]).includes(value)
    ? (value as Complexity)
    : null;
}
