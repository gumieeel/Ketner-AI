import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPath,
  isNonCanonicalHost,
  llmsTxt,
  renderIndexHtml,
  robotsTxt,
  sitemapXml,
  trailingSlashRedirect,
  SEO_PAGES,
} from './pages.js';

const BASE = `<!doctype html><html><head><meta name="description" content="old" /><title>Ketner AI</title><script>x()</script></head><body><div id="root"></div></body></html>`;

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

test('seo: классификация адресов', () => {
  assert.equal(classifyPath('/'), 'public');
  assert.equal(classifyPath('/pricing/'), 'public');
  assert.equal(classifyPath('/docs/plans/pro'), 'public');
  assert.equal(classifyPath('/chat/abc'), 'private');
  assert.equal(classifyPath('/settings'), 'private');
  // Ввод кода из письма и восстановление пароля — служебные страницы, а не 404.
  assert.equal(classifyPath('/signup/verify'), 'private');
  assert.equal(classifyPath('/login/verify'), 'private');
  assert.equal(classifyPath('/login/forgot'), 'private');
  assert.equal(classifyPath('/login/forgot/verify'), 'private');
  assert.equal(classifyPath('/login/forgot/new'), 'private');
  assert.equal(classifyPath('/wp-admin'), 'missing');
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
});

test('seo: готовая разметка попадает в #root только на открытых страницах', () => {
  const page = {
    html: '<h1>Тарифы $& </h1>',
    head: '<script type="application/ld+json">{}</script>',
  };
  const pricing = renderIndexHtml(BASE, '/pricing', page);
  assert.match(
    pricing,
    /<div id="root"><h1>Тарифы \$& <\/h1><\/div>/,
    'шаблоны replace не раскрываются',
  );
  assert.match(pricing, /application\/ld\+json">\{\}/);
  assert.match(pricing, /BreadcrumbList/, 'хлебные крошки на внутренних страницах');
  const hidden = renderIndexHtml(BASE, '/__none__', page);
  assert.match(hidden, /<div id="root"><\/div>/);
  assert.doesNotMatch(hidden, /ld\+json">\{\}/);
});

test('seo: дубли тарифов в документации ссылаются на /docs и не попадают в sitemap', () => {
  const html = renderIndexHtml(BASE, '/docs/plans/pro');
  assert.match(html, /<link rel="canonical" href="https:\/\/ketner\.org\/docs" \/>/);
  assert.doesNotMatch(html, /BreadcrumbList/);
  assert.doesNotMatch(sitemapXml(), /docs\/plans/);
  for (const page of SEO_PAGES) {
    assert.ok(page.description.length <= 250, `${page.path}: описание длиннее 250 символов`);
    assert.ok(page.title.length <= 75, `${page.path}: заголовок длиннее 75 символов`);
  }
});

test('seo: Яндекс склеивает адреса с метками, копия на Render не индексируется', () => {
  assert.match(robotsTxt(), /User-agent: Yandex[\s\S]*Clean-param: utm_source&[^\n]*yclid/);
  assert.equal(isNonCanonicalHost('ketner.org'), false);
  assert.equal(isNonCanonicalHost('www.ketner.org'), false);
  assert.equal(isNonCanonicalHost('localhost:8787'), false);
  assert.equal(isNonCanonicalHost('ketner-ai.onrender.com'), true);
  assert.equal(isNonCanonicalHost(undefined), false);
});

test('seo: lastmod пишется только для страниц с известной датой', () => {
  const sitemap = sitemapXml({ '/changelog': '2026-10-18', '/docs/plans/pro': '2026-10-01' });
  assert.match(
    sitemap,
    /<loc>https:\/\/ketner\.org\/changelog<\/loc>\n\s+<lastmod>2026-10-18<\/lastmod>/,
  );
  assert.equal(sitemap.match(/<lastmod>/g)?.length, 1, 'у остальных страниц lastmod нет');
  assert.doesNotMatch(sitemapXml(), /<lastmod>/);
});

test('seo: адрес со слэшем в конце ведёт на основной, остальное не трогаем', () => {
  assert.equal(trailingSlashRedirect('/pricing/'), '/pricing');
  assert.equal(trailingSlashRedirect('/docs/plans/pro/'), '/docs/plans/pro');
  assert.equal(trailingSlashRedirect('/pricing'), null);
  assert.equal(trailingSlashRedirect('/'), null);
  assert.equal(trailingSlashRedirect('/chat/'), null, 'закрытые разделы не перенаправляются');
  assert.equal(trailingSlashRedirect('/api/'), null);
  assert.equal(trailingSlashRedirect('//evil.example/'), null, 'чужой адрес не подставляется');
});

test('seo: английская версия — свой язык, canonical и пара hreflang', () => {
  const en = renderIndexHtml('<html lang="ru"><head><title>x</title></head></html>', '/en/pricing');
  assert.match(en, /<html lang="en"/);
  assert.match(en, /<title>Ketner AI pricing/);
  assert.match(en, /<link rel="canonical" href="https:\/\/ketner\.org\/en\/pricing" \/>/);
  assert.match(en, /og:locale" content="en_US"/);
  assert.match(en, /hreflang="ru" href="https:\/\/ketner\.org\/pricing"/);
  assert.match(en, /hreflang="en" href="https:\/\/ketner\.org\/en\/pricing"/);
  assert.match(en, /hreflang="x-default" href="https:\/\/ketner\.org\/pricing"/);
  assert.match(en, /"name":"Pricing"/, 'хлебные крошки на английском');

  const ru = renderIndexHtml(BASE, '/pricing');
  assert.match(ru, /og:locale" content="ru_RU"/);
  assert.match(ru, /hreflang="en" href="https:\/\/ketner\.org\/en\/pricing"/);
  assert.doesNotMatch(
    renderIndexHtml(BASE, '/models'),
    /hreflang/,
    'у страницы без двойника пары нет',
  );
});

test('seo: у каждой английской страницы есть русская пара, дубли планов ведут на /en/docs', () => {
  const english = SEO_PAGES.filter((page) => page.lang === 'en');
  assert.ok(english.length >= 9);
  for (const page of english) {
    const ruPath = page.path === '/en' ? '/' : page.path.slice('/en'.length);
    const ru = SEO_PAGES.find((candidate) => candidate.path === ruPath);
    assert.ok(ru, `${page.path}: нет русской страницы ${ruPath}`);
    assert.equal(page.sitemap, ru.sitemap, `${page.path}: sitemap как у русской`);
    assert.ok(
      !/[А-Яа-яЁё]/.test(`${page.title}${page.description}`),
      `${page.path}: русские буквы`,
    );
  }
  const html = renderIndexHtml(BASE, '/en/docs/plans/pro');
  assert.match(html, /<link rel="canonical" href="https:\/\/ketner\.org\/en\/docs" \/>/);
  assert.equal(classifyPath('/en/pricing'), 'public');
  assert.equal(classifyPath('/en/models'), 'missing');
  assert.equal(trailingSlashRedirect('/en/pricing/'), '/en/pricing');
});

test('seo: sitemap со ссылками hreflang и llms.txt с английским разделом', () => {
  const sitemap = sitemapXml();
  assert.match(sitemap, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  assert.match(sitemap, /<loc>https:\/\/ketner\.org\/en\/pricing<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/ketner\.org\/en<\/loc>/);
  assert.doesNotMatch(sitemap, /en\/docs\/plans/);
  assert.match(
    sitemap,
    /<loc>https:\/\/ketner\.org\/pricing<\/loc>\n\s+<xhtml:link rel="alternate" hreflang="ru" href="https:\/\/ketner\.org\/pricing"\/>\n\s+<xhtml:link rel="alternate" hreflang="en" href="https:\/\/ketner\.org\/en\/pricing"\/>/,
  );
  assert.doesNotMatch(
    sitemap,
    /<loc>https:\/\/ketner\.org\/models<\/loc>\n\s+<xhtml:link/,
    'у страницы без двойника ссылок нет',
  );
  const llms = llmsTxt();
  assert.match(llms, /^# Ketner AI\n/);
  assert.match(
    llms,
    /## English\n- \[Ketner AI — ChatGPT, Claude, Gemini and Grok in one AI chat\]\(https:\/\/ketner\.org\/en\)/,
  );
  assert.doesNotMatch(llms, /\/chat|\/settings|\/admin/);
});
