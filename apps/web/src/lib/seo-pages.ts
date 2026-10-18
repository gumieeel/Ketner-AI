import seoPagesData from '../../../mock-api/src/seo/seo-pages.json';

/**
 * Открытые страницы сайта: заголовок и описание для поисковиков.
 *
 * Один файл на сервер и сайт (apps/mock-api/src/seo/seo-pages.json): сервер пишет заголовок в HTML,
 * сайт ставит тот же заголовок вкладки при переходах внутри приложения и отрисовывает эти страницы
 * при сборке (entry-prerender.tsx). Иначе после загрузки скриптов поисковик видел бы другой title.
 */
export interface SeoPageMeta {
  /** Язык страницы; без поля — русский (английские двойники лежат под /en). */
  lang?: 'ru' | 'en';
  path: string;
  title: string;
  description: string;
  canonical?: string;
  sitemap?: boolean;
}

export const SEO_PAGES: readonly SeoPageMeta[] = seoPagesData.pages as SeoPageMeta[];

export const DEFAULT_TITLE = 'Ketner AI';

function normalize(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

/** Заголовок вкладки для адреса; для страниц вне списка — undefined (страница задаёт свой). */
export function seoTitleFor(pathname: string): string | undefined {
  const path = normalize(pathname);
  return SEO_PAGES.find((page) => page.path === path)?.title;
}
