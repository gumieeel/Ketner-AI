/**
 * Поисковая оптимизация: заголовки и описания страниц прямо в HTML с сервера, robots.txt и sitemap.xml.
 *
 * Сайт собирается в браузере (SPA), а поисковый робот часто читает только исходный HTML. Раньше у всех
 * страниц был один заголовок «Ketner AI» и одно описание, а robots.txt и sitemap.xml отдавали главную
 * страницу. Здесь для каждой открытой страницы задаются свои заголовок, описание, canonical и превью
 * ссылки (Open Graph), закрытые разделы (чат, настройки, оплата) помечаются noindex, а несуществующие
 * адреса отвечают 404, а не копией главной.
 */

export interface SeoPage {
  path: string;
  title: string;
  description: string;
  /** Приоритет в sitemap.xml. */
  priority: number;
  changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly';
}

const BRAND = 'Ketner AI';

/** Открытые страницы: попадают в sitemap и индексируются. */
export const SEO_PAGES: readonly SeoPage[] = [
  {
    path: '/',
    title: 'Ketner AI — ChatGPT, Claude, Gemini и Grok в одном ИИ-чате на русском',
    description:
      'Нейросети GPT, Claude, Gemini, Grok и DeepSeek в одном чате на русском языке. Режим Auto сам выбирает модель, генерация картинок, ИИ для кода. Бесплатный тариф, оплата звёздами Telegram и криптовалютой.',
    priority: 1,
    changefreq: 'weekly',
  },
  {
    path: '/pricing',
    title: 'Тарифы Ketner AI — ChatGPT, Claude и Gemini по одной подписке',
    description:
      'Бесплатный тариф и подписки Plus, Pro и Ultra: GPT, Claude Opus и Sonnet, Gemini и Grok без отдельных подписок у каждого сервиса. Оплата звёздами Telegram и криптовалютой.',
    priority: 0.9,
    changefreq: 'weekly',
  },
  {
    path: '/docs',
    title: 'Как пользоваться Ketner AI — модели, тарифы и возможности',
    description:
      'Справка Ketner AI: какие нейросети доступны на каждом тарифе, режим Auto и режим Max, работа с файлами и проектами, генерация изображений, Ketner Code.',
    priority: 0.7,
    changefreq: 'weekly',
  },
  {
    path: '/docs/plans/free',
    title: 'Бесплатный тариф Ketner AI — ИИ-чат без оплаты',
    description:
      'Что входит в бесплатный тариф Ketner AI: ИИ-чат на русском, режим Auto, генерация картинок и лимиты в день.',
    priority: 0.6,
    changefreq: 'monthly',
  },
  {
    path: '/docs/plans/plus',
    title: 'Тариф Plus в Ketner AI — GPT и сильные модели недорого',
    description:
      'Тариф Plus в Ketner AI: доступ к сильным моделям GPT, Claude Haiku, Gemini Flash и DeepSeek, больше сообщений и API-ключи.',
    priority: 0.6,
    changefreq: 'monthly',
  },
  {
    path: '/docs/plans/pro',
    title: 'Тариф Pro в Ketner AI — Claude Opus, Sonnet, GPT и Grok',
    description:
      'Тариф Pro в Ketner AI: флагманские модели Claude Opus и Sonnet, GPT, Grok и Gemini в одной подписке, повышенный приоритет.',
    priority: 0.6,
    changefreq: 'monthly',
  },
  {
    path: '/docs/plans/ultra',
    title: 'Тариф Ultra в Ketner AI — все модели и режим Max',
    description:
      'Тариф Ultra в Ketner AI: все модели Pro, режим Max с глубокими размышлениями, большой контекст и максимальный приоритет.',
    priority: 0.6,
    changefreq: 'monthly',
  },
  {
    path: '/docs/api',
    title: 'API Ketner AI — OpenAI-совместимый API для GPT и Claude',
    description:
      'OpenAI-совместимый API Ketner AI для CLI, IDE и своих приложений: GPT, Claude, Gemini и другие модели по одному ключу, вызов инструментов и стриминг.',
    priority: 0.6,
    changefreq: 'monthly',
  },
  {
    path: '/models',
    title: 'Модели Ketner AI — кто разработал каждую нейросеть и какие лимиты',
    description:
      'Все модели Ketner AI: разработчик (OpenAI, Anthropic, Google, xAI и другие), какая модель стоит за Ketner Mini и Ketner Pro, тариф, недельные лимиты и запасные модели.',
    priority: 0.7,
    changefreq: 'weekly',
  },
  {
    path: '/about',
    title: 'О проекте Ketner AI — кто мы и что делаем',
    description:
      'Ketner AI — независимый сервис доступа к моделям разных разработчиков в одном чате. Кто его делает, какую задачу решает, этап разработки и планы.',
    priority: 0.5,
    changefreq: 'monthly',
  },
  {
    path: '/changelog',
    title: 'Что нового в Ketner AI — журнал обновлений',
    description:
      'Журнал обновлений Ketner AI: даты выпусков, новые функции, исправления, известные ограничения и планы.',
    priority: 0.5,
    changefreq: 'weekly',
  },
  {
    path: '/status',
    title: 'Статус Ketner AI — работа сервиса и сбои',
    description:
      'Текущее состояние Ketner AI: сайт, база данных, модели, генерация изображений, оплата и бот, известные проблемы и история сбоев.',
    priority: 0.3,
    changefreq: 'daily',
  },
  {
    path: '/signup',
    title: 'Регистрация в Ketner AI — начать бесплатно',
    description:
      'Создайте аккаунт Ketner AI через Google, GitHub, Telegram или почту и начните пользоваться нейросетями бесплатно.',
    priority: 0.5,
    changefreq: 'yearly',
  },
  {
    path: '/contacts',
    title: 'Контакты Ketner AI — поддержка',
    description:
      'Как связаться с Ketner AI: форма обратной связи, почта и бот поддержки в Telegram.',
    priority: 0.3,
    changefreq: 'yearly',
  },
  {
    path: '/terms',
    title: 'Пользовательское соглашение — Ketner AI',
    description: 'Пользовательское соглашение сервиса Ketner AI.',
    priority: 0.2,
    changefreq: 'yearly',
  },
  {
    path: '/privacy',
    title: 'Политика конфиденциальности — Ketner AI',
    description:
      'Какие данные собирает Ketner AI, где хранит, кому передаёт запросы (OpenRouter и разработчики моделей), как обрабатывает файлы, историю чатов и платежи, когда удаляет.',
    priority: 0.2,
    changefreq: 'yearly',
  },
  {
    path: '/payment-terms',
    title: 'Условия оплаты и возврата — Ketner AI',
    description:
      'Условия оплаты подписки Ketner AI звёздами Telegram и криптовалютой, правила возврата.',
    priority: 0.2,
    changefreq: 'yearly',
  },
];

/**
 * Разделы приложения: существуют, но не для поиска (личные данные, оплата, служебные страницы).
 * Отдаются со статусом 200 и `noindex`.
 */
const PRIVATE_PREFIXES = [
  '/login',
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
  '/docs/plans',
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
      name: BRAND,
      url: `${base}/`,
      applicationCategory: 'ProductivityApplication',
      operatingSystem: 'Web, iOS, Android',
      inLanguage: ['ru', 'en'],
      description:
        'ИИ-чат с нейросетями GPT, Claude, Gemini, Grok и DeepSeek в одной подписке, генерация изображений и ИИ для программирования.',
      offers: [
        { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' },
        { '@type': 'Offer', name: 'Plus', price: '9', priceCurrency: 'USD' },
        { '@type': 'Offer', name: 'Pro', price: '25', priceCurrency: 'USD' },
        { '@type': 'Offer', name: 'Ultra', price: '49', priceCurrency: 'USD' },
      ],
    },
  ];
  return jsonLd({ '@context': 'https://schema.org', '@graph': graph });
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

/**
 * index.html для конкретного адреса: свой title, description, canonical, robots и превью ссылки.
 * Встроенные скрипты не меняются, поэтому хеши в CSP остаются верными.
 */
export function renderIndexHtml(baseHtml: string, rawPath: string): string {
  const base = siteUrl();
  const kind = classifyPath(rawPath);
  const page = findSeoPage(rawPath);
  const title = page?.title ?? BRAND;
  const description = page?.description ?? SEO_PAGES[0].description;
  const canonical = page ? `${base}${page.path === '/' ? '/' : page.path}` : null;
  const image = `${base}/og-image.png`;

  const head = [
    `<meta name="robots" content="${kind === 'public' ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'}" />`,
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
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(description)}" />`,
    `<meta name="twitter:image" content="${escapeAttr(image)}" />`,
    verificationTags(),
    page?.path === '/' ? `<script type="application/ld+json">${structuredData(base)}</script>` : '',
  ]
    .filter(Boolean)
    .join('\n    ');

  let html = baseHtml.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeAttr(title)}</title>`);
  html = html.replace(
    /<meta\s+name="description"[\s\S]*?\/>/i,
    `<meta name="description" content="${escapeAttr(description)}" />`,
  );
  return html.replace(/<\/head>/i, `    ${head}\n  </head>`);
}

export function robotsTxt(): string {
  const base = siteUrl();
  return [
    'User-agent: *',
    'Allow: /',
    ...DISALLOW.map((path) => `Disallow: ${path}`),
    '',
    `Host: ${new URL(base).host}`,
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');
}

export function sitemapXml(lastModified = new Date()): string {
  const base = siteUrl();
  const lastmod = lastModified.toISOString().slice(0, 10);
  const urls = SEO_PAGES.map(
    (page) =>
      `  <url>\n    <loc>${escapeXml(`${base}${page.path === '/' ? '/' : page.path}`)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${page.changefreq}</changefreq>\n    <priority>${page.priority.toFixed(1)}</priority>\n  </url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
