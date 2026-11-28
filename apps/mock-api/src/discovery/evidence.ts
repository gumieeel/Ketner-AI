/**
 * Проверка цитат модели (анализ v2, B3): «что теряется сейчас» и находки по сайту показываются,
 * только если цитата действительно есть в источнике — на этой странице сайта, в описании человека
 * или в его ответах. Как проверка чисел (impact.ts, verifyTaskNumbers): непроверенное не попадает
 * в отчёт.
 */

import type { LostNow, SiteFindingOutput } from './schemas.js';

/** Минимальная длина цитаты: короче — совпадение случайно. */
const MIN_QUOTE = 8;

/** Сравнение без регистра, лишних пробелов, кавычек и разницы «е/ё». */
export function normalizeQuote(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"“”„'’`]/g, '')
    .replace(/[\s\u00a0]+/g, ' ')
    .replace(/\s*…\s*$/, '')
    .trim();
}

/** Текст сайта в анализе: блоки «## /путь — заголовок» (site-crawl.ts). */
export interface SiteText {
  text: string;
  pages?: ReadonlyArray<{ path: string }>;
}

/** Текст одной страницы из общего текста сайта; null — страница не прочитана. */
export function pageSection(site: SiteText, page: string): string | null {
  const header = `## ${page}`;
  const lines = site.text.split('\n');
  const start = lines.findIndex((line) => line === header || line.startsWith(`${header} — `));
  if (start < 0) {
    // Анализ до чтения нескольких страниц: весь текст — главная.
    return !site.pages && page === '/' ? site.text : null;
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## /'));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

function contains(haystack: string, quote: string): boolean {
  const needle = normalizeQuote(quote);
  return needle.length >= MIN_QUOTE && normalizeQuote(haystack).includes(needle);
}

/** Находки по сайту — только с цитатой, которая есть на названной странице. */
export function verifySiteFindings(
  findings: readonly SiteFindingOutput[],
  site: SiteText | null,
): SiteFindingOutput[] {
  if (!site) return [];
  return findings.filter((finding) => {
    const section = pageSection(site, finding.page);
    return section !== null && contains(section, finding.evidence);
  });
}

export interface EvidenceSources {
  site: SiteText | null;
  description: string;
  answers: readonly string[];
}

/**
 * «Что теряется сейчас» — только с проверенной цитатой. Для сайта страница уточняется: если она не
 * названа или названа неверно, берётся та, где цитата есть. Нет цитаты нигде — null.
 */
export function verifyLostNow(lostNow: LostNow | null, sources: EvidenceSources): LostNow | null {
  if (!lostNow) return null;
  if (lostNow.source === 'description') {
    return contains(sources.description, lostNow.evidence) ? { ...lostNow, page: null } : null;
  }
  if (lostNow.source === 'answer') {
    return sources.answers.some((answer) => contains(answer, lostNow.evidence))
      ? { ...lostNow, page: null }
      : null;
  }
  const site = sources.site;
  if (!site) return null;
  const named = lostNow.page ? pageSection(site, lostNow.page) : null;
  if (named !== null && contains(named, lostNow.evidence)) return lostNow;
  for (const page of site.pages ?? [{ path: '/' }]) {
    const section = pageSection(site, page.path);
    if (section !== null && contains(section, lostNow.evidence)) {
      return { ...lostNow, page: page.path };
    }
  }
  return null;
}
