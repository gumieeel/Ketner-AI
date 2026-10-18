import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANS } from '../routes/billing.js';
import { pricingMarkdown } from './pricing-md.js';
import {
  classifyPath,
  llmsTxt,
  renderIndexHtml,
  robotsTxt,
  setSeoBuildData,
  sitemapXml,
  SEO_PAGES,
  SEO_PAGES_EN,
} from './pages.js';

const BASE = `<!doctype html><html lang="ru"><head><meta name="description" content="old" /><title>Ketner AI</title><script>x()</script></head><body><div id="root"></div></body></html>`;

test('seo: у каждой открытой страницы свой заголовок, canonical и index', () => {
  const html = renderIndexHtml(BASE, '/pricing');
  assert.match(html, /<title>Тарифы Ketner AI/);
  assert.match(html, /<link rel="canonical" href="https:\/\/ketner\.org\/pricing" \/>/);
  assert.match(html, /content="index, follow/);
  assert.match(html, /og:image" content="https:\/\/ketner\.org\/og-image\.png"/);
  assert.doesNotMatch(html, /content="old"/);
  assert.match(html, /<script>x\(\)<\/script>/, 'встроенные скрипты не меняются (хеши CSP)');
  const titles = new Set(SEO_PAGES.map((p) => p.title));
  assert.equal(titles.size, SEO_PAGES.length, 'заголовки не повторяются');
});

test('seo: главная содержит разметку Schema.org, закрытые разделы — noindex', () => {
  assert.match(renderIndexHtml(BASE, '/'), /application\/ld\+json/);
  const chat = renderIndexHtml(BASE, '/__none__');
  assert.match(chat, /noindex, nofollow/);
  assert.doesNotMatch(chat, /rel="canonical"/);
});

test('seo: цены в разметке берутся из тарифов', () => {
  const html = renderIndexHtml(BASE, '/');
  assert.match(html, /"name":"Pro","price":"25","priceCurrency":"USD"/);
});

test('seo: классификация адресов', () => {
  assert.equal(classifyPath('/'), 'public');
  assert.equal(classifyPath('/pricing/'), 'public');
  assert.equal(classifyPath('/docs/plans/pro'), 'public');
  assert.equal(classifyPath('/chat/abc'), 'private');
  assert.equal(classifyPath('/settings'), 'private');
  // Ввод кода из письма — служебные страницы, а не 404.
  assert.equal(classifyPath('/signup/verify'), 'private');
  assert.equal(classifyPath('/login/verify'), 'private');
  assert.equal(classifyPath('/wp-admin'), 'missing');
  assert.equal(classifyPath('/docs/plans/foo'), 'missing');
});

test('seo: robots.txt и sitemap.xml', () => {
  const robots = robotsTxt();
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Disallow: \/chat/);
  assert.match(robots, /Sitemap: https:\/\/ketner\.org\/sitemap\.xml/);
  const sitemap = sitemapXml();
  assert.match(sitemap, /<loc>https:\/\/ketner\.org\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/ketner\.org\/pricing<\/loc>/);
  assert.doesNotMatch(sitemap, /\/chat/);
  assert.doesNotMatch(sitemap, /<lastmod>/, 'без настоящей даты lastmod не выводится');
  assert.doesNotMatch(robots, /^Host:/m);
});

test('seo: заголовки на клиенте совпадают с серверными', async () => {
  const file = new URL('../../../web/src/lib/seo-titles.ts', import.meta.url).href;
  const { PAGE_TITLES } = (await import(file)) as { PAGE_TITLES: Record<string, string> };
  assert.deepEqual(
    PAGE_TITLES,
    Object.fromEntries(SEO_PAGES.map((page) => [page.path, page.title])),
  );
});

test('seo: в HTML публичной страницы есть текст для краулеров, у закрытой — пустой корень', () => {
  const pricing = renderIndexHtml(BASE, '/pricing');
  assert.match(pricing, /<div id="root"><main><h1>Тарифы Ketner AI<\/h1>/);
  assert.match(pricing, /Pro — \$25 в месяц/);
  assert.match(pricing, /<a href="https:\/\/ketner\.org\/models">/);
  assert.match(renderIndexHtml(BASE, '/__none__'), /<div id="root"><\/div>/);
  for (const page of SEO_PAGES) {
    const html = renderIndexHtml(BASE, page.path);
    assert.match(html, /<div id="root"><main><h1>/, page.path);
  }
});

test('seo: llms.txt перечисляет открытые страницы', () => {
  const txt = llmsTxt();
  assert.match(txt, /^# Ketner AI/);
  assert.match(txt, /\(https:\/\/ketner\.org\/pricing\)/);
  for (const page of SEO_PAGES)
    assert.ok(txt.includes(`${page.path === '/' ? '/' : page.path})`), page.path);
  assert.doesNotMatch(txt, /\/chat/);
});

test('seo: английские страницы — свой язык, canonical и пары hreflang', () => {
  const html = renderIndexHtml(BASE.replace('<html>', '<html lang="ru">'), '/en/pricing');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>Ketner AI pricing/);
  assert.match(html, /<link rel="canonical" href="https:\/\/ketner\.org\/en\/pricing" \/>/);
  assert.match(html, /hreflang="ru" href="https:\/\/ketner\.org\/pricing"/);
  assert.match(html, /hreflang="en" href="https:\/\/ketner\.org\/en\/pricing"/);
  assert.match(html, /hreflang="x-default" href="https:\/\/ketner\.org\/pricing"/);
  assert.match(html, /og:locale" content="en_US"/);
  assert.match(html, /<h1>Ketner AI pricing<\/h1>/);
  assert.match(html, /Pro is \$25 a month/);
  // Русская версия указывает на английскую.
  const ru = renderIndexHtml(BASE, '/pricing');
  assert.match(ru, /hreflang="en" href="https:\/\/ketner\.org\/en\/pricing"/);
  // Страница без перевода: без hreflang.
  assert.doesNotMatch(renderIndexHtml(BASE, '/models'), /hreflang/);
  // Разметка на английской главной.
  assert.match(renderIndexHtml(BASE, '/en'), /"description":"An AI chat with GPT/);
});

test('seo: адреса /en классифицируются, непереведённые — нет', () => {
  assert.equal(classifyPath('/en'), 'public');
  assert.equal(classifyPath('/en/'), 'public');
  assert.equal(classifyPath('/en/docs/plans/pro'), 'public');
  assert.equal(classifyPath('/en/models'), 'missing');
  assert.equal(classifyPath('/en/chat'), 'missing');
  const titles = new Set([...SEO_PAGES, ...SEO_PAGES_EN].map((p) => p.title));
  assert.equal(titles.size, SEO_PAGES.length + SEO_PAGES_EN.length, 'заголовки уникальны');
});

test('seo: sitemap содержит английские страницы с взаимными ссылками', () => {
  const sitemap = sitemapXml();
  assert.match(sitemap, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  assert.match(sitemap, /<loc>https:\/\/ketner\.org\/en<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/ketner\.org\/en\/pricing<\/loc>/);
  const entry = sitemap
    .split('<url>')
    .find((chunk) => chunk.includes('<loc>https://ketner.org/en/pricing</loc>'));
  assert.ok(
    entry?.includes('hreflang="ru" href="https://ketner.org/pricing"'),
    'есть ссылка на русскую',
  );
  assert.ok(
    entry?.includes('hreflang="en" href="https://ketner.org/en/pricing"'),
    'есть ссылка на себя',
  );
  const models = sitemap.split('<url>').find((chunk) => chunk.includes('/models</loc>'));
  assert.ok(models && !models.includes('hreflang'));
  assert.match(llmsTxt(), /## English[\s\S]*\/en\/pricing/);
});

test('seo: заголовки английской версии на клиенте совпадают с серверными', async () => {
  const file = new URL('../../../web/src/lib/seo-titles.ts', import.meta.url).href;
  const { PAGE_TITLES_EN } = (await import(file)) as { PAGE_TITLES_EN: Record<string, string> };
  assert.deepEqual(
    PAGE_TITLES_EN,
    Object.fromEntries(
      SEO_PAGES_EN.map((page) => [page.path === '/en' ? '/' : page.path.slice(3), page.title]),
    ),
  );
});

test('seo: список страниц с английской версией совпадает с клиентским', async () => {
  const file = new URL('../../../web/src/lib/locale-path.ts', import.meta.url).href;
  const { hasEnglishTwin } = (await import(file)) as {
    hasEnglishTwin: (path: string) => boolean;
  };
  for (const page of SEO_PAGES) {
    assert.equal(
      hasEnglishTwin(page.path),
      SEO_PAGES_EN.some((en) => en.path === (page.path === '/' ? '/en' : `/en${page.path}`)),
      page.path,
    );
  }
});

test('seo: на главной есть FAQPage и блок вопросов, на остальных — нет', () => {
  const faq = {
    ru: [{ q: 'Есть ли ограничения?', a: 'Да, <лимиты> тарифа.' }],
    en: [{ q: 'Are there limits?', a: 'Yes, plan limits.' }],
  };
  const ru = renderIndexHtml(BASE, '/', faq);
  assert.match(ru, /"@type":"FAQPage"/);
  assert.match(ru, /"name":"Есть ли ограничения\?"/);
  assert.match(ru, /<h3>Есть ли ограничения\?<\/h3><p>Да, &lt;лимиты&gt; тарифа\.<\/p>/);
  assert.doesNotMatch(ru, /Are there limits/);
  const en = renderIndexHtml(BASE, '/en', faq);
  assert.match(en, /"inLanguage":"en","mainEntity"/);
  assert.match(en, /<h3>Are there limits\?<\/h3>/);
  assert.doesNotMatch(renderIndexHtml(BASE, '/pricing', faq), /FAQPage|Есть ли/);
  assert.doesNotMatch(renderIndexHtml(BASE, '/'), /FAQPage/, 'без данных блока нет');
});

test('seo: lastmod у /changelog — дата последнего релиза, у остальных страниц его нет', () => {
  setSeoBuildData({ changelogDate: '2026-10-18' });
  try {
    const sitemap = sitemapXml();
    const changelog = sitemap.split('<url>').find((chunk) => chunk.includes('/changelog</loc>'));
    assert.match(changelog ?? '', /<lastmod>2026-10-18<\/lastmod>/);
    assert.equal(sitemap.match(/<lastmod>/g)?.length, 1);
  } finally {
    setSeoBuildData({});
  }
});

test('seo: robots.txt даёт ботам ИИ-поиска собственную группу с теми же закрытыми разделами', () => {
  const robots = robotsTxt();
  for (const bot of ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Claude-SearchBot']) {
    assert.match(robots, new RegExp(`^User-agent: ${bot}$`, 'm'), bot);
  }
  assert.doesNotMatch(robots, /GPTBot$|ClaudeBot$/m, 'боты обучения не упоминаются');
  const group = robots.split('# ИИ-поиск')[1];
  assert.match(group, /Disallow: \/chat/);
  assert.match(group, /Disallow: \/api\//);
  assert.match(group, /Allow: \//);
});

test('seo: вопросы с главной называют те же цены, что и каталог тарифов', async () => {
  const file = new URL('../../../web/src/features/content/faq.ts', import.meta.url).href;
  const { FAQ_ITEMS } = (await import(file)) as {
    FAQ_ITEMS: { id: string; a: Record<'ru' | 'en', string> }[];
  };
  const price = FAQ_ITEMS.find((item) => item.id === 'price');
  assert.ok(price);
  for (const language of ['ru', 'en'] as const) {
    for (const plan of PLANS.filter((p) => p.priceMonthly > 0)) {
      assert.ok(price.a[language].includes(`$${plan.priceMonthly}`), `${language} ${plan.id}`);
    }
  }
});

test('seo: pricing.md собирается из каталога тарифов', () => {
  const ru = pricingMarkdown(PLANS, 'ru', 'https://ketner.org', new Date('2026-10-18T10:00:00Z'));
  assert.match(ru, /^# Ketner AI — Тарифы/);
  assert.match(ru, /Актуально на: 2026-10-18/);
  assert.match(ru, /## Pro\n- Цена: \$25 в месяц \(30 дней\)/);
  assert.match(ru, /## Free\n- Цена: Бесплатно \(\$0\)/);
  assert.match(ru, /1 500 сообщений в сутки/);
  assert.match(ru, /\(https:\/\/ketner\.org\/pricing\)/);
  const en = pricingMarkdown(PLANS, 'en', 'https://ketner.org');
  assert.match(en, /^# Ketner AI — Pricing/);
  assert.match(en, /## Ultra\n- Price: \$49 per month \(30 days\)/);
  assert.match(en, /1,500 messages a day/);
  assert.match(en, /\(https:\/\/ketner\.org\/en\/pricing\)/);
  assert.doesNotMatch(ru + en, /gpt-pro|claude-pro|gemini-pro/, 'устаревшие тарифы не включены');
  assert.match(
    renderIndexHtml(BASE, '/pricing'),
    /rel="alternate" type="text\/markdown" href="https:\/\/ketner\.org\/pricing\.md"/,
  );
  assert.match(
    renderIndexHtml(BASE, '/en/pricing'),
    /href="https:\/\/ketner\.org\/en\/pricing\.md"/,
  );
  assert.match(llmsTxt(), /pricing\.md/);
});
