/** Ответ GET /api/usage/quota (apps/mock-api/src/services/premium-quota.ts). */

export type QuotaLimitedBy = 'quota' | 'week' | 'day' | 'budget' | null;

export interface ModelQuota {
  id: string;
  name: string;
  requestCostUsd: number;
  priceSource: 'observed' | 'estimate';
  /** Сколько запросов примерно осталось. */
  remaining: number;
  remainingByQuota: number;
  pool: { weekly: number; perDay: number; weekRemaining: number; dayRemaining: number } | null;
  limitedBy: QuotaLimitedBy;
  /** Когда вернётся хотя бы один запрос, если сейчас их 0. */
  restoresAt: string | null;
}

export interface QuotaReport {
  plan: string;
  reasoningMode: 'standard' | 'max';
  premium: {
    budgetUsd: number;
    spentUsd: number;
    remainingUsd: number;
    usedPct: number;
    available: boolean;
    warning: boolean;
    restoresAt: string | null;
  };
  budget: { stage: 'normal' | 'soft' | 'exhausted' | 'hard_stop'; usedPct: number };
  models: ModelQuota[];
}
