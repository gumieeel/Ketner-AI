/**
 * Currency Service — конвертация валют и расчёт допустимой себестоимости.
 *
 * Курс нужен для справочных сумм в рублях (СБП, админка). Цены тарифов хранятся в долларах
 * (services/pricing.ts), затраты на API моделей тоже в долларах.
 */

import { config } from '../config.js';

let currentRate = config.usdToRubRate;

export class CurrencyService {
  /**
   * Текущий обменный курс USD к RUB.
   * Читается из config.usdToRubRate (по умолчанию 95.0),
   * может динамически обновляться администратором через API.
   */
  static getUsdToRubRate(): number {
    return currentRate;
  }

  /**
   * Обновить обменный курс на лету без перезапуска сервиса.
   */
  static setUsdToRubRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Некорректный курс USD/RUB: ${rate}. Курс должен быть положительным числом.`);
    }
    currentRate = Math.round(rate * 100) / 100;
  }

  /**
   * Конвертировать рубли в доллары США.
   */
  static rubToUsd(rub: number): number {
    if (rub <= 0) return 0;
    return Math.round((rub / currentRate) * 100) / 100;
  }

  /**
   * Конвертировать доллары США в рубли.
   */
  static usdToRub(usd: number): number {
    if (usd <= 0) return 0;
    return Math.round(usd * currentRate * 100) / 100;
  }

  /**
   * Бюджет себестоимости AI для тарифа (из него выводится месячная выдача кредитов).
   *
   * Формула: бюджет = priceMonthlyUsd * targetCostRatio. Доля 0.31–0.41 цены оставляет
   * на эквайринг и налоги ≈10–13% (для Stars до 28%), на комиссию OpenRouter 5.5% от расхода,
   * на субсидию Free-тира и прибыль остальное (расчёт в docs/models-and-pricing.md).
   */
  static calculatePlanCostBudget(priceMonthlyUsd: number, targetCostRatio = 0.4): number {
    if (priceMonthlyUsd <= 0) return 0.2; // субсидируемый буфер для free
    return Math.round(priceMonthlyUsd * targetCostRatio * 100) / 100;
  }
}
