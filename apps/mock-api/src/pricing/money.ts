/**
 * Точная арифметика для смет.
 *
 * Деньги — целые тенге, часы — целые сотые часа («центичасы»), проценты — базисные пункты
 * (1% = 100), коэффициенты — тысячные (1.5 = 1500). Умножение с делением идёт через BigInt с
 * округлением половины вверх: ни одной операции с дробными числами с плавающей точкой в расчёте
 * суммы нет, результат одинаков на любой машине и воспроизводим по снимку.
 */

/** a × b / c с округлением половины вверх (все аргументы — неотрицательные целые). */
export function mulDiv(a: number, b: number, c: number): number {
  assertInt(a, 'a');
  assertInt(b, 'b');
  assertInt(c, 'c');
  if (c <= 0) throw new Error('mulDiv: делитель должен быть положительным');
  if (a < 0 || b < 0) throw new Error('mulDiv: отрицательные значения не поддерживаются');
  const product = BigInt(a) * BigInt(b);
  const divisor = BigInt(c);
  const result = (product * 2n + divisor) / (divisor * 2n);
  return toSafe(result);
}

/** Округление вверх до кратного `step` (шаг 0 или 1 — без округления). */
export function ceilTo(value: number, step: number): number {
  assertInt(value, 'value');
  assertInt(step, 'step');
  if (step <= 1) return value;
  return Math.ceil(value / step) * step;
}

/** Часы (до двух знаков) → центичасы. */
export function toCentiHours(hours: number): number {
  if (!Number.isFinite(hours) || hours < 0) throw new Error(`Некорректные часы: ${hours}`);
  return Math.round(hours * 100);
}

/** Коэффициент (до трёх знаков) → тысячные. */
export function toMilli(factor: number): number {
  if (!Number.isFinite(factor) || factor < 0)
    throw new Error(`Некорректный коэффициент: ${factor}`);
  return Math.round(factor * 1000);
}

/** Проценты (до двух знаков) → базисные пункты. */
export function toBasisPoints(percent: number): number {
  if (!Number.isFinite(percent) || percent < 0) throw new Error(`Некорректный процент: ${percent}`);
  return Math.round(percent * 100);
}

/** Центичасы → часы для показа (до двух знаков). */
export function centiToHours(centi: number): number {
  return centi / 100;
}

function assertInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) throw new Error(`mulDiv: ${name} = ${value} — не целое число`);
}

function toSafe(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Сумма вне допустимого диапазона');
  return Number(value);
}
