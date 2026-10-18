import type { Language } from '@/features/preferences/preferences-store';

/**
 * Английская версия публичных страниц живёт под префиксом /en (русская — без префикса).
 * Префикс есть только у страниц, которые переведены целиком: остальные (модели, о проекте,
 * правовые документы и т.д.) остаются на русском и адреса /en у них нет.
 * Список должен совпадать с серверным (apps/mock-api/src/seo/pages.ts), это проверяет тест.
 */
export const EN_PREFIX = '/en';

const TWIN_PATTERN = /^\/(?:|pricing|docs|docs\/plans\/(?:free|plus|pro|ultra)|docs\/api|signup)$/;

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

/** Есть ли у страницы (адрес без префикса) английская версия. */
export function hasEnglishTwin(pathname: string): boolean {
  return TWIN_PATTERN.test(cleanPath(stripEn(pathname)));
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
