/**
 * Калибровка сметы по фактическим проектам.
 *
 * Сравнивает снимок сметы заявки (то, что видел клиент) с фактом, который записал администратор.
 * Часы проекта не разбиты по работам, поэтому отношение «факт / ожидание» проекта относится к каждой
 * его работе целиком — это грубая, но честная оценка; рекомендация появляется только при
 * достаточном числе проектов (`calibrationMinSamples`) и заметном отклонении, а применяет её
 * администратор вручную (новая версия каталога с причиной). Автоматически ничего не меняется.
 */

import type { CatalogItem, PricingConfig } from './catalog.js';
import type { ImplementationRequest } from './types.js';

export interface ErrorStats {
  key: string;
  projects: number;
  /** Медиана «факт / ожидание» по часам; 1 — точно. */
  medianHoursRatio: number;
  /** Средняя абсолютная ошибка по часам, %. */
  meanAbsHoursErrorPct: number;
}

export interface Recommendation {
  capabilityId: string;
  currentHoursExpected: number;
  suggestedHoursExpected: number;
  projects: number;
  medianHoursRatio: number;
}

export interface CalibrationReport {
  projects: number;
  overall: {
    meanAbsHoursErrorPct: number | null;
    medianHoursRatio: number | null;
    /** Средняя разница итоговой цены и ожидаемой цены сметы, %. */
    meanPriceDeviationPct: number | null;
    /** Средняя разница фактических и оценённых прямых расходов, ₸. */
    meanDirectDeviationKzt: number | null;
  };
  byCapability: ErrorStats[];
  byIndustry: ErrorStats[];
  bySolutionType: ErrorStats[];
  byIntegration: ErrorStats[];
  recommendations: Recommendation[];
  /** Проекты, по которым считали (без персональных данных клиента). */
  samples: Array<{
    requestId: string;
    estimatedHours: number;
    actualHours: number;
    expectedPriceKzt: number | null;
    finalPriceKzt: number;
    deviationReasons: string;
  }>;
}

const DEVIATION_THRESHOLD = 0.15;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

function stats(groups: Map<string, number[]>): ErrorStats[] {
  return [...groups.entries()]
    .map(([key, ratios]) => ({
      key,
      projects: ratios.length,
      medianHoursRatio: round(median(ratios)),
      meanAbsHoursErrorPct: round(
        (ratios.reduce((sum, r) => sum + Math.abs(r - 1), 0) / ratios.length) * 100,
        1,
      ),
    }))
    .sort((a, b) => b.projects - a.projects || a.key.localeCompare(b.key));
}

function push(map: Map<string, number[]>, key: string, value: number) {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

export function calibrationReport(
  requests: readonly ImplementationRequest[],
  catalog: readonly CatalogItem[],
  config: PricingConfig,
): CalibrationReport {
  const done = requests.filter(
    (item) =>
      item.actuals && item.snapshot.result.hours.expected > 0 && item.actuals.actualHours > 0,
  );
  const byCapability = new Map<string, number[]>();
  const byIndustry = new Map<string, number[]>();
  const bySolutionType = new Map<string, number[]>();
  const byIntegration = new Map<string, number[]>();
  const priceDeviations: number[] = [];
  const directDeviations: number[] = [];
  const ratios: number[] = [];

  for (const request of done) {
    const result = request.snapshot.result;
    const actuals = request.actuals!;
    const ratio = actuals.actualHours / result.hours.expected;
    ratios.push(ratio);
    push(byIndustry, request.industry ?? 'unknown', ratio);
    for (const type of result.solutionTypes) push(bySolutionType, type, ratio);
    for (const line of result.lines) {
      if (line.projectTask) continue;
      push(byCapability, line.capabilityId, ratio);
      if (line.category === 'integration' || line.category === 'channel') {
        push(byIntegration, line.capabilityId, ratio);
      }
    }
    const expectedPrice = request.reviewed?.priceKzt.expected ?? result.priceKzt?.expected ?? null;
    if (expectedPrice && expectedPrice > 0) {
      priceDeviations.push((actuals.finalPriceKzt - expectedPrice) / expectedPrice);
    }
    directDeviations.push(actuals.actualDirectKzt - result.directKzt);
  }

  const capabilityStats = stats(byCapability);
  const recommendations: Recommendation[] = [];
  for (const entry of capabilityStats) {
    if (entry.projects < config.calibrationMinSamples) continue;
    if (Math.abs(entry.medianHoursRatio - 1) <= DEVIATION_THRESHOLD) continue;
    const item = catalog.find((candidate) => candidate.id === entry.key);
    if (!item) continue;
    recommendations.push({
      capabilityId: item.id,
      currentHoursExpected: item.hoursExpected,
      // Шаг полчаса: точнее калибровка по нескольким проектам не бывает.
      suggestedHoursExpected: Math.max(
        0.5,
        Math.round(item.hoursExpected * entry.medianHoursRatio * 2) / 2,
      ),
      projects: entry.projects,
      medianHoursRatio: entry.medianHoursRatio,
    });
  }

  const mean = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const meanAbs = mean(ratios.map((r) => Math.abs(r - 1)));
  const meanPrice = mean(priceDeviations);
  const meanDirect = mean(directDeviations);

  return {
    projects: done.length,
    overall: {
      meanAbsHoursErrorPct: meanAbs === null ? null : round(meanAbs * 100, 1),
      medianHoursRatio: ratios.length ? round(median(ratios)) : null,
      meanPriceDeviationPct: meanPrice === null ? null : round(meanPrice * 100, 1),
      meanDirectDeviationKzt: meanDirect === null ? null : Math.round(meanDirect),
    },
    byCapability: capabilityStats,
    byIndustry: stats(byIndustry),
    bySolutionType: stats(bySolutionType),
    byIntegration: stats(byIntegration),
    recommendations,
    samples: done.map((request) => ({
      requestId: request.id,
      estimatedHours: request.snapshot.result.hours.expected / 100,
      actualHours: request.actuals!.actualHours / 100,
      expectedPriceKzt:
        request.reviewed?.priceKzt.expected ?? request.snapshot.result.priceKzt?.expected ?? null,
      finalPriceKzt: request.actuals!.finalPriceKzt,
      deviationReasons: request.actuals!.deviationReasons,
    })),
  };
}
