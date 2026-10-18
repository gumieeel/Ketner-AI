import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPath,
  isNonCanonicalHost,
  renderIndexHtml,
  robotsTxt,
  sitemapXml,
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
  const sitemap = sitemapXml(new Date('2026-10-16T00:00:00Z'));
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
  const sitemap = sitemapXml(new Date('2026-10-16T00:00:00Z'));
  assert.doesNotMatch(sitemap, /docs\/plans/);
  assert.match(sitemap, /<lastmod>2026-10-16<\/lastmod>/);
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
