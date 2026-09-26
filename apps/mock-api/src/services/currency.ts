/**
 * Currency Service — конвертация валют и расчёт допустимой себестоимости.
 *
 * Связывает рублевые тарифы подписок с долларовыми затратами на API моделей.
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
   * Рассчитать предельный бюджет себестоимости AI для тарифа.
   *
   * Формула: costBudget = (priceMonthlyRub / rate) * targetCostRatio
   * targetCostRatio по умолчанию 0.40..0.45 (оставляет 55–60% на эквайринг, налоги, инфра и прибыль).
   */
  static calculatePlanCostBudget(priceMonthlyRub: number, targetCostRatio = 0.40): number {
    if (priceMonthlyRub <= 0) return 0.20; // субсидируемый буфер для free
    const priceUsd = priceMonthlyRub / currentRate;
    return Math.round(priceUsd * targetCostRatio * 100) / 100;
  }
}
