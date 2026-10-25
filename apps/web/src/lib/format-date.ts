import type { Language } from '@/features/preferences/preferences-store';

const LOCALES: Record<Language, string> = { ru: 'ru-RU', en: 'en-US' };

/** Короткая дата для старых диалогов: «12 сент.» / «Sep 12». */
export function formatShortDate(iso: string, language: Language): string {
  return new Intl.DateTimeFormat(LOCALES[language], { day: 'numeric', month: 'short' }).format(
    new Date(iso),
  );
}

export type DateGroup = 'today' | 'yesterday' | 'week' | 'earlier';

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** К какому блоку списка относится диалог: сегодня, вчера, за неделю или раньше. */
export function dateGroupOf(iso: string, now: Date = new Date()): DateGroup {
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / 86_400_000);

  if (days <= 0) {
    return 'today';
  }
  if (days === 1) {
    return 'yesterday';
  }
  if (days <= 7) {
    return 'week';
  }
  return 'earlier';
}

/** Дата и время для подсказок «восстановится …»: «17 окт., 14:05» / «Oct 17, 2:05 PM». */
export function formatDateTime(iso: string, language: Language): string {
  return new Intl.DateTimeFormat(LOCALES[language], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** Форма слова по числу: 1 запрос, 2 запроса, 5 запросов (для английского — one / many). */
export function pluralForm(count: number, language: Language): 'one' | 'few' | 'many' {
  const n = Math.abs(Math.trunc(count));
  if (language === 'en') return n === 1 ? 'one' : 'many';
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'one';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
  return 'many';
}

/** Кредиты с разделителем тысяч: 2 987; у цен запроса — с десятыми (1,8). */
export function formatCredits(value: number, language: Language, fractionDigits = 0): string {
  return value.toLocaleString(LOCALES[language], {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
}
