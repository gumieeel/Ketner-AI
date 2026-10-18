/**
 * Поисковая оптимизация: заголовки и описания страниц прямо в HTML с сервера, robots.txt и sitemap.xml.
 *
 * Сайт собирается в браузере (SPA), а поисковый робот часто читает только исходный HTML. Раньше у всех
 * страниц был один заголовок «Ketner AI» и одно описание, а robots.txt и sitemap.xml отдавали главную
 * страницу. Здесь для каждой открытой страницы задаются свои заголовок, описание, canonical и превью
 * ссылки (Open Graph), закрытые разделы (чат, настройки, оплата) помечаются noindex, а несуществующие
 * адреса отвечают 404, а не копией главной.
 */

import { PLAN_PRICE_USD } from '../services/pricing.js';

/** Вопрос и ответ с главной страницы (из seo-faq.json, который кладёт сборка веб-приложения). */
export interface FaqEntry {
  q: string;
  a: string;
}

export type FaqByLanguage = Record<'ru' | 'en', FaqEntry[]>;

/** Содержимое seo-faq.json. */
export interface SeoBuildData extends FaqByLanguage {
  /** Дата последнего релиза из журнала обновлений (YYYY-MM-DD). */
  changelogDate?: string;
}

/** Подставляет в sitemap настоящие даты изменения, известные по данным сборки. */
let knownLastmod: Readonly<Record<string, string>> = {};
export function setSeoBuildData(data: Pick<SeoBuildData, 'changelogDate'>): void {
  knownLastmod = data.changelogDate ? { '/changelog': data.changelogDate } : {};
}

export interface SeoPage {
  /** Язык страницы; без поля — русский. */
  lang?: 'ru' | 'en';
  path: string;
  title: string;
  description: string;
  /** Дата последнего изменения содержимого (YYYY-MM-DD). Если не известна — не указывать. */
  lastmod?: string;
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

/** Адрес английской версии страницы (/en/...) строится из адреса русской. */
export const EN_PREFIX = '/en';

/**
 * Английская версия есть только у страниц, переведённых целиком. Остальные (модели, о проекте,
 * правовые документы, журнал, статус, контакты) остаются на русском и в /en не попадают.
 */
const EN_TWIN_PATHS = [
  '/',
  '/pricing',
  '/docs',
  '/docs/plans/free',
  '/docs/plans/plus',
  '/docs/plans/pro',
  '/docs/plans/ultra',
  '/docs/api',
  '/signup',
] as const;

const EN_META: Readonly<Record<string, { title: string; description: string }>> = {
  '/': {
    title: 'Ketner AI — ChatGPT, Claude, Gemini and Grok in one AI chat',
    description:
      'GPT, Claude, Gemini, Grok and DeepSeek in a single AI chat. Auto mode picks the right model for each task, with image generation and AI for coding. Free plan, pay with Telegram Stars or crypto.',
  },
  '/pricing': {
    title: 'Ketner AI pricing — ChatGPT, Claude and Gemini in one subscription',
    description:
      'A free plan and Plus, Pro and Ultra subscriptions: GPT, Claude Opus and Sonnet, Gemini and Grok without a separate subscription for each service. Pay with Telegram Stars or crypto.',
  },
  '/docs': {
    title: 'How to use Ketner AI — models, plans and features',
    description:
      'Ketner AI help: which models each plan includes, Auto and Max modes, working with files and projects, image generation and Ketner Code.',
  },
  '/docs/plans/free': {
    title: 'Ketner AI Free plan — AI chat at no cost',
    description:
      'What the Ketner AI Free plan includes: an AI chat, Auto mode, image generation and daily limits.',
  },
  '/docs/plans/plus': {
    title: 'Ketner AI Plus plan — strong GPT models for less',
    description:
      'The Ketner AI Plus plan: strong GPT models, Claude Haiku, Gemini Flash and DeepSeek, more messages and API keys.',
  },
  '/docs/plans/pro': {
    title: 'Ketner AI Pro plan — Claude Opus, Sonnet, GPT and Grok',
    description:
      'The Ketner AI Pro plan: flagship Claude Opus and Sonnet, GPT, Grok and Gemini models in one subscription, with higher priority.',
  },
  '/docs/plans/ultra': {
    title: 'Ketner AI Ultra plan — every model and Max mode',
    description:
      'The Ketner AI Ultra plan: every Pro model, Max mode with deeper reasoning, a large context window and top priority.',
  },
  '/docs/api': {
    title: 'Ketner AI API — OpenAI-compatible API for GPT and Claude',
    description:
      'The OpenAI-compatible Ketner AI API for CLIs, editors and your own apps: GPT, Claude, Gemini and other models with one key, tool calling and streaming.',
  },
  '/signup': {
    title: 'Sign up for Ketner AI — start for free',
    description:
      'Create a Ketner AI account with Google, GitHub, Telegram or email and start using AI models for free.',
  },
};

export function enPath(path: string): string {
  return path === '/' ? EN_PREFIX : `${EN_PREFIX}${path}`;
}

/** Английские страницы: те же приоритет и частота обновления, что у русских. */
export const SEO_PAGES_EN: readonly SeoPage[] = EN_TWIN_PATHS.map((path) => {
  const ru = SEO_PAGES.find((page) => page.path === path)!;
  return { ...ru, lang: 'en' as const, path: enPath(path), ...EN_META[path] };
});

/** Русский адрес страницы: /en/pricing → /pricing. */
function ruPathOf(page: SeoPage): string {
  return page.lang === 'en' ? page.path.slice(EN_PREFIX.length) || '/' : page.path;
}

/** Пара страниц на двух языках, если у страницы есть английская версия. */
function alternatesOf(page: SeoPage): { ru: string; en: string } | null {
  const ru = ruPathOf(page);
  return (EN_TWIN_PATHS as readonly string[]).includes(ru) ? { ru, en: enPath(ru) } : null;
}

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
  return (
    SEO_PAGES.find((page) => page.path === path) ?? SEO_PAGES_EN.find((page) => page.path === path)
  );
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

/** Заголовок и текст страницы для читателей без JavaScript (краулеры Яндекса, Bing, ИИ-ботов). */
interface PageCopy {
  h1: string;
  paragraphs: string[];
}

const price = (plan: keyof typeof PLAN_PRICE_USD): string => `$${PLAN_PRICE_USD[plan]}`;

const PAGE_COPY: Readonly<Record<string, PageCopy>> = {
  '/': {
    h1: 'Ketner AI — ChatGPT, Claude, Gemini и Grok в одном ИИ-чате',
    paragraphs: [
      'Ketner AI собирает нейросети GPT, Claude, Gemini, Grok и DeepSeek в одном чате на русском языке. Не нужно покупать отдельную подписку у каждого сервиса.',
      'Режим Auto сам выбирает подходящую модель под задачу. Кроме текста, есть генерация изображений и Ketner Code — ИИ для программирования с проектами и запуском кода.',
      `Бесплатный тариф без оплаты, платные — Plus (${price('plus')}), Pro (${price('pro')}) и Ultra (${price('ultra')}) в месяц. Оплата звёздами Telegram и криптовалютой. Ketner AI не обучает собственных моделей: все они от сторонних разработчиков.`,
    ],
  },
  '/pricing': {
    h1: 'Тарифы Ketner AI',
    paragraphs: [
      `Free — бесплатно, Plus — ${price('plus')} в месяц, Pro — ${price('pro')} в месяц, Ultra — ${price('ultra')} в месяц.`,
      'Plus открывает сильные модели GPT, Claude Haiku, Gemini Flash и DeepSeek. Pro добавляет Claude Opus и Sonnet, GPT, Grok и Gemini. Ultra включает режим Max с глубокими размышлениями и лучшие модели картинок.',
      'Оплата звёздами Telegram и криптовалютой, подписка без автоматических списаний, если не включить автопродление.',
    ],
  },
  '/docs': {
    h1: 'Как пользоваться Ketner AI',
    paragraphs: [
      'Справка по Ketner AI: какие нейросети доступны на каждом тарифе, как работают режимы Auto и Max, как загружать файлы и вести проекты, как генерировать изображения и писать код в Ketner Code.',
    ],
  },
  '/docs/plans/free': {
    h1: 'Бесплатный тариф Ketner AI',
    paragraphs: [
      'Бесплатный тариф даёт ИИ-чат на русском, режим Auto и генерацию картинок в пределах суточных лимитов, без оплаты и привязки карты.',
    ],
  },
  '/docs/plans/plus': {
    h1: 'Тариф Plus в Ketner AI',
    paragraphs: [
      `Plus стоит ${price('plus')} в месяц. Доступ к сильным моделям GPT, Claude Haiku, Gemini Flash и DeepSeek, больше сообщений в сутки и API-ключи.`,
    ],
  },
  '/docs/plans/pro': {
    h1: 'Тариф Pro в Ketner AI',
    paragraphs: [
      `Pro стоит ${price('pro')} в месяц. Флагманские модели Claude Opus и Sonnet, GPT, Grok и Gemini в одной подписке и повышенный приоритет.`,
    ],
  },
  '/docs/plans/ultra': {
    h1: 'Тариф Ultra в Ketner AI',
    paragraphs: [
      `Ultra стоит ${price('ultra')} в месяц. Все модели Pro, режим Max с глубокими размышлениями, большой контекст и максимальный приоритет.`,
    ],
  },
  '/docs/api': {
    h1: 'API Ketner AI',
    paragraphs: [
      'OpenAI-совместимый API для CLI, редакторов кода и собственных приложений. Модели GPT, Claude, Gemini и другие по одному ключу, вызов инструментов и потоковые ответы.',
    ],
  },
  '/models': {
    h1: 'Модели Ketner AI',
    paragraphs: [
      'Все модели Ketner AI: разработчик каждой нейросети (OpenAI, Anthropic, Google, xAI и другие), какая модель стоит за Ketner Mini и Ketner Pro, на каком тарифе доступна, недельные лимиты и запасные модели.',
    ],
  },
  '/about': {
    h1: 'О проекте Ketner AI',
    paragraphs: [
      'Ketner AI — независимый сервис доступа к моделям разных разработчиков в одном чате. На странице: кто делает сервис, какую задачу он решает, на каком этапе разработки находится и какие планы.',
    ],
  },
  '/changelog': {
    h1: 'Что нового в Ketner AI',
    paragraphs: [
      'Журнал обновлений: даты выпусков, новые функции, исправления, известные ограничения и планы.',
    ],
  },
  '/status': {
    h1: 'Статус Ketner AI',
    paragraphs: [
      'Текущее состояние сайта, базы данных, моделей, генерации изображений, оплаты и бота, известные проблемы и история сбоев.',
    ],
  },
  '/signup': {
    h1: 'Регистрация в Ketner AI',
    paragraphs: [
      'Создайте аккаунт через Google, GitHub, Telegram или почту и начните пользоваться нейросетями бесплатно.',
    ],
  },
  '/contacts': {
    h1: 'Контакты Ketner AI',
    paragraphs: ['Форма обратной связи, почта и бот поддержки в Telegram.'],
  },
};

const PAGE_COPY_EN: Readonly<Record<string, PageCopy>> = {
  '/': {
    h1: 'Ketner AI — ChatGPT, Claude, Gemini and Grok in one AI chat',
    paragraphs: [
      'Ketner AI brings GPT, Claude, Gemini, Grok and DeepSeek into a single chat. You do not need a separate subscription for each service.',
      'Auto mode picks the right model for each task. Beyond text there is image generation and Ketner Code, an AI for programming with projects and code execution.',
      `A free plan with no payment, and paid plans Plus (${price('plus')}), Pro (${price('pro')}) and Ultra (${price('ultra')}) per month. Pay with Telegram Stars or crypto. Ketner AI does not train its own models: all of them come from third-party developers.`,
    ],
  },
  '/pricing': {
    h1: 'Ketner AI pricing',
    paragraphs: [
      `Free costs nothing, Plus is ${price('plus')} a month, Pro is ${price('pro')} a month, Ultra is ${price('ultra')} a month.`,
      'Plus unlocks strong GPT models, Claude Haiku, Gemini Flash and DeepSeek. Pro adds Claude Opus and Sonnet, GPT, Grok and Gemini. Ultra includes Max mode with deeper reasoning and the best image models.',
      'Pay with Telegram Stars or crypto. Subscriptions do not renew automatically unless you turn auto-renewal on.',
    ],
  },
  '/docs': {
    h1: 'How to use Ketner AI',
    paragraphs: [
      'Ketner AI help: which models each plan includes, how Auto and Max modes work, how to upload files and keep projects, how to generate images and write code in Ketner Code.',
    ],
  },
  '/docs/plans/free': {
    h1: 'Ketner AI Free plan',
    paragraphs: [
      'The Free plan gives you an AI chat, Auto mode and image generation within daily limits, with no payment and no card required.',
    ],
  },
  '/docs/plans/plus': {
    h1: 'Ketner AI Plus plan',
    paragraphs: [
      `Plus costs ${price('plus')} a month. It adds strong GPT models, Claude Haiku, Gemini Flash and DeepSeek, more messages per day and API keys.`,
    ],
  },
  '/docs/plans/pro': {
    h1: 'Ketner AI Pro plan',
    paragraphs: [
      `Pro costs ${price('pro')} a month. Flagship Claude Opus and Sonnet, GPT, Grok and Gemini models in one subscription, with higher priority.`,
    ],
  },
  '/docs/plans/ultra': {
    h1: 'Ketner AI Ultra plan',
    paragraphs: [
      `Ultra costs ${price('ultra')} a month. Every Pro model, Max mode with deeper reasoning, a large context window and top priority.`,
    ],
  },
  '/docs/api': {
    h1: 'Ketner AI API',
    paragraphs: [
      'An OpenAI-compatible API for CLIs, code editors and your own apps. GPT, Claude, Gemini and other models with one key, tool calling and streaming responses.',
    ],
  },
  '/signup': {
    h1: 'Sign up for Ketner AI',
    paragraphs: [
      'Create an account with Google, GitHub, Telegram or email and start using AI models for free.',
    ],
  },
};

/** Текст страницы для `<div id="root">`: React заменяет его при запуске, а краулер без JS видит содержимое. */
function crawlerContent(page: SeoPage, base: string, faq: FaqEntry[]): string {
  const english = page.lang === 'en';
  const copyMap = english ? PAGE_COPY_EN : PAGE_COPY;
  const copy = copyMap[ruPathOf(page)] ?? { h1: page.title, paragraphs: [page.description] };
  const links = (english ? SEO_PAGES_EN : SEO_PAGES)
    .filter((item) => copyMap[ruPathOf(item)] !== undefined)
    .map(
      (item) => `<li><a href="${escapeAttr(base + item.path)}">${escapeAttr(item.title)}</a></li>`,
    )
    .join('');
  return [
    '<main>',
    `<h1>${escapeAttr(copy.h1)}</h1>`,
    ...copy.paragraphs.map((text) => `<p>${escapeAttr(text)}</p>`),
    ...(faq.length > 0
      ? [
          `<section><h2>${english ? 'Frequently asked questions' : 'Частые вопросы'}</h2>`,
          ...faq.map((item) => `<h3>${escapeAttr(item.q)}</h3><p>${escapeAttr(item.a)}</p>`),
          '</section>',
        ]
      : []),
    `<nav aria-label="${english ? 'Site sections' : 'Разделы сайта'}"><ul>${links}</ul></nav>`,
    '</main>',
  ].join('');
}

function structuredData(base: string, english: boolean, faq: FaqEntry[]): string {
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
      inLanguage: ['ru', 'en'],
      publisher: { '@id': `${base}/#organization` },
    },
    {
      '@type': 'WebApplication',
      name: BRAND,
      url: english ? `${base}${EN_PREFIX}` : `${base}/`,
      applicationCategory: 'ProductivityApplication',
      operatingSystem: 'Web, iOS, Android',
      inLanguage: ['ru', 'en'],
      description: english
        ? 'An AI chat with GPT, Claude, Gemini, Grok and DeepSeek in one subscription, plus image generation and AI for programming.'
        : 'ИИ-чат с нейросетями GPT, Claude, Gemini, Grok и DeepSeek в одной подписке, генерация изображений и ИИ для программирования.',
      offers: (['free', 'plus', 'pro', 'ultra'] as const).map((plan) => ({
        '@type': 'Offer',
        name: plan.charAt(0).toUpperCase() + plan.slice(1),
        price: String(PLAN_PRICE_USD[plan]),
        priceCurrency: 'USD',
      })),
    },
    ...(faq.length > 0
      ? [
          {
            '@type': 'FAQPage',
            inLanguage: english ? 'en' : 'ru',
            mainEntity: faq.map((item) => ({
              '@type': 'Question',
              name: item.q,
              acceptedAnswer: { '@type': 'Answer', text: item.a },
            })),
          },
        ]
      : []),
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
export function renderIndexHtml(
  baseHtml: string,
  rawPath: string,
  faqByLanguage?: FaqByLanguage,
): string {
  const base = siteUrl();
  const kind = classifyPath(rawPath);
  const page = findSeoPage(rawPath);
  const title = page?.title ?? BRAND;
  const description = page?.description ?? SEO_PAGES[0].description;
  const canonical = page ? `${base}${page.path === '/' ? '/' : page.path}` : null;
  const english = page?.lang === 'en';
  const alternates = page ? alternatesOf(page) : null;
  // Вопросы и ответы показаны на главной, поэтому разметка FAQPage — только там.
  const faq = page && ruPathOf(page) === '/' ? (faqByLanguage?.[english ? 'en' : 'ru'] ?? []) : [];
  const alternateUrl = (path: string): string => escapeAttr(`${base}${path}`);
  const image = `${base}/og-image.png`;

  const head = [
    `<meta name="robots" content="${kind === 'public' ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'}" />`,
    canonical ? `<link rel="canonical" href="${escapeAttr(canonical)}" />` : '',
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${BRAND}" />`,
    `<meta property="og:locale" content="${english ? 'en_US' : 'ru_RU'}" />`,
    alternates
      ? `<meta property="og:locale:alternate" content="${english ? 'ru_RU' : 'en_US'}" />`
      : '',
    ...(alternates
      ? [
          `<link rel="alternate" hreflang="ru" href="${alternateUrl(alternates.ru)}" />`,
          `<link rel="alternate" hreflang="en" href="${alternateUrl(alternates.en)}" />`,
          `<link rel="alternate" hreflang="x-default" href="${alternateUrl(alternates.ru)}" />`,
        ]
      : []),
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
    page && ruPathOf(page) === '/pricing'
      ? `<link rel="alternate" type="text/markdown" href="${escapeAttr(`${base}${english ? '/en' : ''}/pricing.md`)}" />`
      : '',
    verificationTags(),
    page && ruPathOf(page) === '/'
      ? `<script type="application/ld+json">${structuredData(base, english, faq)}</script>`
      : '',
  ]
    .filter(Boolean)
    .join('\n    ');

  let html = baseHtml.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeAttr(title)}</title>`);
  if (english) html = html.replace(/<html\s+lang="ru"/i, '<html lang="en"');
  html = html.replace(
    /<meta\s+name="description"[\s\S]*?\/>/i,
    `<meta name="description" content="${escapeAttr(description)}" />`,
  );
  if (page) {
    html = html.replace(
      /<div id="root"><\/div>/i,
      () => `<div id="root">${crawlerContent(page, base, faq)}</div>`,
    );
  }
  return html.replace(/<\/head>/i, `    ${head}\n  </head>`);
}

/**
 * Боты ИИ-поиска и ассистентов, которые приходят за ответом пользователю (а не за обучением моделей).
 * Для них выделена своя группа: у каждого бота правила берутся из его группы целиком, поэтому
 * список закрытых разделов повторён. Боты обучения (GPTBot, ClaudeBot) здесь не упомянуты и
 * подчиняются общей группе `*`.
 */
const AI_SEARCH_BOTS = [
  'OAI-SearchBot',
  'ChatGPT-User',
  'PerplexityBot',
  'Perplexity-User',
  'Claude-SearchBot',
  'Claude-User',
] as const;

export function robotsTxt(): string {
  const base = siteUrl();
  const rules = ['Allow: /', ...DISALLOW.map((path) => `Disallow: ${path}`)];
  return [
    'User-agent: *',
    ...rules,
    '',
    '# ИИ-поиск и ассистенты: публичные страницы открыты',
    ...AI_SEARCH_BOTS.map((bot) => `User-agent: ${bot}`),
    ...rules,
    '',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');
}

/**
 * `lastmod` указывается только там, где известна настоящая дата изменения страницы (`SeoPage.lastmod`).
 * Подставлять сегодняшнюю дату всем страницам нельзя: поисковики перестают доверять такому полю.
 */
const lastmodOf = (page: SeoPage): string | undefined =>
  page.lastmod ?? (page.lang === 'en' ? undefined : knownLastmod[page.path]);

export function sitemapXml(): string {
  const base = siteUrl();
  const loc = (path: string): string => escapeXml(`${base}${path}`);
  const urls = [...SEO_PAGES, ...SEO_PAGES_EN].map((page) => {
    const alternates = alternatesOf(page);
    const links = alternates
      ? [
          `    <xhtml:link rel="alternate" hreflang="ru" href="${loc(alternates.ru)}"/>`,
          `    <xhtml:link rel="alternate" hreflang="en" href="${loc(alternates.en)}"/>`,
          `    <xhtml:link rel="alternate" hreflang="x-default" href="${loc(alternates.ru)}"/>`,
        ].join('\n') + '\n'
      : '';
    return `  <url>\n    <loc>${loc(page.path)}</loc>\n${links}${lastmodOf(page) ? `    <lastmod>${lastmodOf(page)}</lastmod>\n` : ''}    <changefreq>${page.changefreq}</changefreq>\n    <priority>${page.priority.toFixed(1)}</priority>\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}

/** llms.txt: краткая карта сайта для ИИ-ассистентов (https://llmstxt.org). */
export function llmsTxt(): string {
  const base = siteUrl();
  const link = (page: SeoPage): string =>
    `- [${page.title}](${base}${page.path === '/' ? '/' : page.path}): ${page.description}`;
  const group = (paths: string[]): string[] =>
    SEO_PAGES.filter((page) => paths.includes(page.path)).map(link);
  return [
    `# ${BRAND}`,
    '',
    `> ${SEO_PAGES[0].description}`,
    '',
    'Ketner AI не обучает собственных моделей: все модели от сторонних разработчиков (OpenAI, Anthropic, Google, xAI и других).',
    '',
    '## Продукт',
    ...group(['/', '/pricing', '/models', '/signup']),
    `- [Тарифы простым текстом](${base}/pricing.md): цены, лимиты и модели каждого тарифа в Markdown`,
    '',
    '## Документация',
    ...group([
      '/docs',
      '/docs/plans/free',
      '/docs/plans/plus',
      '/docs/plans/pro',
      '/docs/plans/ultra',
      '/docs/api',
    ]),
    '',
    '## О сервисе',
    ...group(['/about', '/changelog', '/status', '/contacts']),
    '',
    '## Правовые документы',
    ...group(['/terms', '/privacy', '/payment-terms']),
    '',
    '## English',
    ...SEO_PAGES_EN.map(link),
    `- [Pricing as plain text](${base}/en/pricing.md): prices, limits and models for every plan in Markdown`,
    '',
  ].join('\n');
}
