/**
 * Политика месячного бюджета себестоимости.
 *
 * Безлимит держится на том, что расход каждого пользователя остаётся в пределах costBudget плана.
 * Раньше при превышении бюджета запрос лишь «мягко» переключался на дешёвую модель, а жёсткого
 * потолка не было: дешёвые модели тоже стоят денег, и расход мог расти без границы.
 */

/** Доля бюджета, после которой включается экономный режим (короткие ответы, дешёвые модели). */
export const BUDGET_SOFT_RATIO = 0.8;
/** Бюджет исчерпан: все запросы только на самых дешёвых движках. */
export const BUDGET_EXHAUSTED_RATIO = 1.0;
/** Жёсткий потолок: дальше запросы отклоняются до обновления периода. */
export const BUDGET_HARD_STOP_RATIO = 1.25;

export type BudgetStage = 'normal' | 'soft' | 'exhausted' | 'hard_stop';

export interface BudgetState {
  ratio: number;
  stage: BudgetStage;
}

export function evaluateBudget(monthlyCost: number, costBudget: number): BudgetState {
  if (!(costBudget > 0)) {
    return { ratio: 0, stage: 'normal' };
  }
  const ratio = Math.max(0, monthlyCost) / costBudget;
  if (ratio >= BUDGET_HARD_STOP_RATIO) return { ratio, stage: 'hard_stop' };
  if (ratio >= BUDGET_EXHAUSTED_RATIO) return { ratio, stage: 'exhausted' };
  if (ratio >= BUDGET_SOFT_RATIO) return { ratio, stage: 'soft' };
  return { ratio, stage: 'normal' };
}
