import seoPagesData from '../../../mock-api/src/seo/seo-pages.json';
import { siteFeatures, type SiteFeatures } from './features';
import { productSwitch, type ProductFeature } from './product-switches';

/**
 * Открытые страницы сайта: заголовок и описание для поисковиков.
 *
 * Один файл на сервер и сайт (apps/mock-api/src/seo/seo-pages.json): сервер пишет заголовок в HTML,
 * сайт ставит тот же заголовок вкладки при переходах внутри приложения и отрисовывает эти страницы
 * при сборке (entry-prerender.tsx). Иначе после загрузки скриптов поисковик видел бы другой title.
 */
export interface SeoPageMeta {
  path: string;
  title: string;
  description: string;
  canonical?: string;
  sitemap?: boolean;
  /** Заголовок и описание при включённой платформе решений (`DISCOVERY_ENABLED`). */
  discovery?: { title: string; description: string };
  /** Страница закрытой возможности (product-switches.ts): не отрисовывается при сборке. */
  feature?: ProductFeature;
}

export const SEO_PAGES: readonly SeoPageMeta[] = (seoPagesData.pages as SeoPageMeta[]).filter(
  (page) => !page.feature || productSwitch(page.feature),
);

export const DEFAULT_TITLE = 'Ketner AI';

function normalize(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

/** Заголовок вкладки для адреса; для страниц вне списка — undefined (страница задаёт свой). */
export function seoTitleFor(
  pathname: string,
  features: SiteFeatures = siteFeatures(),
): string | undefined {
  const path = normalize(pathname);
  const page = SEO_PAGES.find((item) => item.path === path);
  return (features.discovery ? page?.discovery?.title : undefined) ?? page?.title;
}
