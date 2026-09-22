export type ClassValue = string | false | null | undefined;

/**
 * Склеивает классы, отбрасывая пустые значения.
 * Заменяет clsx/tailwind-merge, пока в них нет необходимости.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}
