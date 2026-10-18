import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPath,
  llmsTxt,
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
