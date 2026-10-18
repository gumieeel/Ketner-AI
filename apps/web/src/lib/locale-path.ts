import type { Language } from '@/features/preferences/preferences-store';
import { SEO_PAGES } from '@/lib/seo-pages';

/**
 * Английская версия публичных страниц живёт под префиксом /en (русская — без префикса).
 * Префикс есть только у страниц, которые переведены целиком: остальные (модели, о проекте,
 * правовые документы и т.д.) остаются на русском и адреса /en у них нет.
 * Список страниц берётся из seo-pages.json (записи с lang: "en") — того же файла, что читает сервер,
 * поэтому адреса для сайта и для поисковиков не расходятся.
 */
export const EN_PREFIX = '/en';

function cleanPath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export function isEnPath(pathname: string): boolean {
  return pathname === EN_PREFIX || pathname.startsWith(`${EN_PREFIX}/`);
}

/** Путь без языкового префикса: /en/pricing → /pricing, /en → /. */
export function stripEn(pathname: string): string {
  if (!isEnPath(pathname)) return pathname;
  return pathname.slice(EN_PREFIX.length) || '/';
}

/** Адреса (без префикса) страниц, у которых есть английская версия. */
const ENGLISH_TWINS: ReadonlySet<string> = new Set(
  SEO_PAGES.filter((page) => page.lang === 'en').map((page) => stripEn(page.path)),
);

/** Есть ли у страницы (адрес с префиксом или без) английская версия. */
export function hasEnglishTwin(pathname: string): boolean {
  return ENGLISH_TWINS.has(cleanPath(stripEn(pathname)));
}

/** Адрес страницы на нужном языке; `to` может содержать ?query и #hash. Прочие адреса не меняются. */
export function localizePath(to: string, language: Language): string {
  if (!to.startsWith('/')) return to;
  const match = /^([^?#]*)(.*)$/.exec(to);
  const path = match?.[1] ?? to;
  const rest = match?.[2] ?? '';
  const base = cleanPath(stripEn(path));
  if (!hasEnglishTwin(base)) return to;
  if (language === 'ru') return `${base}${rest}`;
  return `${EN_PREFIX}${base === '/' ? '' : base}${rest}`;
}
