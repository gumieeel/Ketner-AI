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
