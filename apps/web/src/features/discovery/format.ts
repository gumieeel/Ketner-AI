import type { Translator } from '@/i18n';

/** Когда снова доступен бесплатный анализ, по времени пользователя: «после 05:00» / «31 окт. после 05:00». */
export function resetTimeText(
  language: Translator['language'],
  iso: string,
  now = new Date(),
): string {
  const date = new Date(iso);
  const locale = language === 'en' ? 'en-US' : 'ru-RU';
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
  const sameDay = date.toDateString() === now.toDateString();
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date);
  if (language === 'en') return sameDay ? `after ${time}` : `on ${day} after ${time}`;
  return sameDay ? `после ${time}` : `${day} после ${time}`;
}
