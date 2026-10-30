import type { Translator, TranslationKey } from '@/i18n';
import { formatCredits, pluralForm } from '@/lib/format-date';

/** «9 кредитов», «8,7 кредита», «1 кредит». Дробное число в русском — «кредита». */
export function creditsText({ t, language }: Translator, value: number): string {
  const form = language === 'ru' && !Number.isInteger(value) ? 'few' : pluralForm(value, language);
  return t(`analysis.credits.${form}` as TranslationKey, {
    count: formatCredits(value, language, 1),
  });
}

/** «≈ 9, не больше 27 кредитов» — как цена модели в чате. */
export function priceText(translator: Translator, typical: number, max: number): string {
  return translator.t('analysis.price', {
    typical: formatCredits(typical, translator.language, 1),
    max: creditsText(translator, max),
  });
}

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
