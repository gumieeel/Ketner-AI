/**
 * Поисковая оптимизация: заголовки и описания страниц прямо в HTML с сервера, robots.txt и sitemap.xml.
 *
 * Сайт собирается в браузере (SPA), а поисковый робот часто читает только исходный HTML. Раньше у всех
 * страниц был один заголовок «Ketner AI» и одно описание, а robots.txt и sitemap.xml отдавали главную
 * страницу. Здесь для каждой открытой страницы задаются свои заголовок, описание, canonical и превью
 * ссылки (Open Graph), закрытые разделы (чат, настройки, оплата) помечаются noindex, а несуществующие
 * адреса отвечают 404, а не копией главной.
 */

import seoPagesData from './seo-pages.json' with { type: 'json' };

export interface SeoPage {
  path: string;
  /** Короткое имя для хлебных крошек: «Тарифы», «Модели». */
  name: string;
  title: string;
  description: string;
  /** Приоритет в sitemap.xml. */
  priority: number;
  changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** Основной адрес, если страница дублирует другую (например, /docs/plans/pro → /docs). */
  canonical?: string;
  /** false — страница не попадает в sitemap.xml. */
  sitemap?: boolean;
}

const BRAND = 'Ketner AI';

/**
 * Открытые страницы: индексируются, большинство попадает в sitemap. Данные лежат в seo-pages.json —
 * их же читает сайт (заголовок вкладки, список страниц для предварительной отрисовки).
 */
export const SEO_PAGES: readonly SeoPage[] = seoPagesData.pages as SeoPage[];

/**
 * Разделы приложения: существуют, но не для поиска (личные данные, оплата, служебные страницы).
 * Отдаются со статусом 200 и `noindex`.
 */
const PRIVATE_PREFIXES = [
  '/login',
  '/signup/verify',
  '/auth',
  '/chat',
  '/code',
  '/images',
  '/settings',
  '/checkout',
  '/tg',
  '/api-docs',
  '/developers',
  '/onboarding',
  '/admin',
];

const DISALLOW = [
  '/api/',
  '/v1/',
  '/chat',
  '/code',
  '/images',
  '/settings',
  '/checkout',
  '/tg',
  '/auth',
  '/onboarding',
  '/admin',
  '/login',
  '/signup/verify',
];

export type PageKind = 'public' | 'private' | 'missing';

function normalizePath(raw: string): string {
  const path = raw.split('?')[0].split('#')[0] || '/';
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

export function findSeoPage(rawPath: string): SeoPage | undefined {
  const path = normalizePath(rawPath);
  return SEO_PAGES.find((page) => page.path === path);
}

export function classifyPath(rawPath: string): PageKind {
  const path = normalizePath(rawPath);
  if (findSeoPage(path)) return 'public';
  if (PRIVATE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)))
    return 'private';
  return 'missing';
}

/** Адрес сайта для canonical и sitemap: SITE_URL, иначе адрес веб-приложения (https), иначе ketner.org. */
export function siteUrl(): string {
  const candidates = [process.env.SITE_URL, process.env.WEB_APP_URL];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (url.protocol === 'https:') return url.origin;
    } catch {
      // не адрес
    }
  }
  return 'https://ketner.org';
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXml(value: string): string {
  return escapeAttr(value).replace(/'/g, '&apos;');
}

/** JSON для <script type="application/ld+json">: `<` экранируется, чтобы строка не закрыла тег. */
function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function structuredData(base: string): string {
  const graph = [
    {
      '@type': 'Organization',
      '@id': `${base}/#organization`,
      name: BRAND,
      url: `${base}/`,
      logo: `${base}/logo-mark.png`,
      email: 'ketner.support@gmail.com',
      sameAs: ['https://t.me/ketner_support_bot'],
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: 'ketner.support@gmail.com',
        url: `${base}/contacts`,
        availableLanguage: ['Russian', 'English'],
      },
    },
    {
      '@type': 'WebSite',
      '@id': `${base}/#website`,
      name: BRAND,
      alternateName: ['Кетнер', 'Ketner', 'Кетнер ИИ'],
      url: `${base}/`,
      inLanguage: 'ru',
      publisher: { '@id': `${base}/#organization` },
    },
    {
      '@type': 'WebApplication',
      '@id': `${base}/#app`,
      name: BRAND,
      url: `${base}/`,
      applicationCategory: 'ProductivityApplication',
      operatingSystem: 'Web, iOS, Android',
      browserRequirements: 'Современный браузер с поддержкой JavaScript',
      inLanguage: ['ru', 'en'],
      image: `${base}/og-image.png`,
      description:
        'ИИ-чат с нейросетями GPT, Claude, Gemini, Grok и DeepSeek в одной подписке, генерация изображений и ИИ для программирования.',
      publisher: { '@id': `${base}/#organization` },
      offers: [
        { name: 'Free', price: '0' },
        { name: 'Plus', price: '9' },
        { name: 'Pro', price: '25' },
        { name: 'Ultra', price: '49' },
      ].map((offer) => ({
        '@type': 'Offer',
        ...offer,
        priceCurrency: 'USD',
        url: `${base}/pricing`,
        availability: 'https://schema.org/InStock',
      })),
    },
  ];
  return jsonLd({ '@context': 'https://schema.org', '@graph': graph });
}

/** Хлебные крошки для страниц второго уровня: в выдаче вместо адреса видно «Ketner AI › Тарифы». */
function breadcrumbs(base: string, page: SeoPage): string {
  if (page.path === '/' || page.canonical) return '';
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: BRAND, item: `${base}/` },
      { '@type': 'ListItem', position: 2, name: page.name, item: `${base}${page.path}` },
    ],
  });
}

/** Метатеги подтверждения владения для Google Search Console и Яндекс Вебмастера (из переменных окружения). */
function verificationTags(): string {
  const tags: string[] = [];
  const google = process.env.GOOGLE_SITE_VERIFICATION?.trim();
  const yandex = process.env.YANDEX_VERIFICATION?.trim();
  if (google) tags.push(`<meta name="google-site-verification" content="${escapeAttr(google)}" />`);
  if (yandex) tags.push(`<meta name="yandex-verification" content="${escapeAttr(yandex)}" />`);
  return tags.join('\n    ');
}

function absolute(base: string, path: string): string {
  return `${base}${path === '/' ? '/' : path}`;
}

/** Предварительно отрисованная страница (apps/web/scripts/prerender.mjs, файл dist/.prerender.json). */
export interface PrerenderedPage {
  /** Разметка для `<div id="root">`. */
  html: string;
  /** Дополнительные теги для `<head>` (например, разметка FAQ). */
  head?: string;
}

/**
 * index.html для конкретного адреса: свой title, description, canonical, robots и превью ссылки,
 * а для открытых страниц — готовая разметка в `#root`, чтобы робот видел текст и ссылки без JavaScript.
 * Встроенные скрипты не меняются, поэтому хеши в CSP остаются верными.
 */
export function renderIndexHtml(
  baseHtml: string,
  rawPath: string,
  prerendered?: PrerenderedPage,
): string {
  const base = siteUrl();
  const kind = classifyPath(rawPath);
  const page = findSeoPage(rawPath);
  const title = page?.title ?? BRAND;
  const description = page?.description ?? SEO_PAGES[0].description;
  const canonical = page ? absolute(base, page.canonical ?? page.path) : null;
  const image = `${base}/og-image.png`;
  const crumbs = page ? breadcrumbs(base, page) : '';

  const head = [
    `<meta name="robots" content="${kind === 'public' ? 'index, follow, max-image-preview:large, max-snippet:-1' : 'noindex, nofollow'}" />`,
    canonical ? `<link rel="canonical" href="${escapeAttr(canonical)}" />` : '',
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${BRAND}" />`,
    `<meta property="og:locale" content="ru_RU" />`,
    `<meta property="og:title" content="${escapeAttr(title)}" />`,
    `<meta property="og:description" content="${escapeAttr(description)}" />`,
    canonical ? `<meta property="og:url" content="${escapeAttr(canonical)}" />` : '',
    `<meta property="og:image" content="${escapeAttr(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${BRAND}: все сильные модели в одной подписке" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(description)}" />`,
    `<meta name="twitter:image" content="${escapeAttr(image)}" />`,
    verificationTags(),
    page?.path === '/' ? `<script type="application/ld+json">${structuredData(base)}</script>` : '',
    crumbs ? `<script type="application/ld+json">${crumbs}</script>` : '',
    kind === 'public' && prerendered?.head ? prerendered.head : '',
  ]
    .filter(Boolean)
    .join('\n    ');

  let html = baseHtml.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeAttr(title)}</title>`);
  html = html.replace(
    /<meta\s+name="description"[\s\S]*?\/>/i,
    `<meta name="description" content="${escapeAttr(description)}" />`,
  );
  html = html.replace(/<\/head>/i, `    ${head}\n  </head>`);
  if (kind === 'public' && prerendered?.html) {
    // Функция вместо строки: в разметке могут встретиться `$&` и подобные шаблоны replace.
    html = html.replace('<div id="root"></div>', () => `<div id="root">${prerendered.html}</div>`);
  }
  return html;
}

/** Параметры меток, которые не меняют содержимое страницы: Яндекс не будет считать такие адреса дублями. */
const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'gclid',
  'yclid',
  'fbclid',
  'ysclid',
  'from',
];

export function robotsTxt(): string {
  const base = siteUrl();
  return [
    'User-agent: *',
    'Allow: /',
    ...DISALLOW.map((path) => `Disallow: ${path}`),
    '',
    'User-agent: Yandex',
    'Allow: /',
    ...DISALLOW.map((path) => `Disallow: ${path}`),
    `Clean-param: ${TRACKING_PARAMS.join('&')}`,
    '',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');
}

/** lastModified — время сборки сайта (дата изменения index.html), а не время запроса. */
export function sitemapXml(lastModified = new Date()): string {
  const base = siteUrl();
  const lastmod = lastModified.toISOString().slice(0, 10);
  const urls = SEO_PAGES.filter((page) => page.sitemap !== false).map(
    (page) =>
      `  <url>\n    <loc>${escapeXml(absolute(base, page.path))}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${page.changefreq}</changefreq>\n    <priority>${page.priority.toFixed(1)}</priority>\n  </url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/**
 * Хост, который не является основным адресом сайта (например, ketner-ai.onrender.com): страницы с него
 * получают X-Robots-Tag noindex, чтобы в выдаче не было двух копий сайта.
 */
export function isNonCanonicalHost(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = host.split(':')[0].toLowerCase();
  const canonical = new URL(siteUrl()).hostname;
  if (hostname === canonical || hostname === `www.${canonical}`) return false;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return false;
  return true;
}
