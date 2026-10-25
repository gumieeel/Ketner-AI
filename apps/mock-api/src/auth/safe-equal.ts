import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Сравнение секретов за постоянное время.
 * Оба значения предварительно хэшируются SHA-256, поэтому длина не раскрывается,
 * а `timingSafeEqual` всегда получает буферы одинакового размера.
 */
export function safeEqualStrings(
  a: string | undefined | null,
  b: string | undefined | null,
): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0) {
    return false;
  }
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}
