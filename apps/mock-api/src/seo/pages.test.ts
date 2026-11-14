import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPath,
  isNonCanonicalHost,
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
  // Страницы закрытых возможностей (product-switches.ts): служебные, а не 404 и не открытые.
  for (const closed of ['/models', '/docs', '/docs/plans/pro', '/docs/api']) {
    assert.equal(classifyPath(closed), 'private', closed);
  }
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

test('seo: страницы закрытых чата и API — noindex, без canonical и не в sitemap', () => {
  for (const closed of ['/models', '/docs', '/docs/plans/pro', '/docs/api']) {
    const html = renderIndexHtml(BASE, closed, { html: '<h1>старое</h1>' });
    assert.match(html, /noindex, nofollow/, closed);
    assert.doesNotMatch(html, /rel="canonical"/, closed);
    assert.match(html, /<div id="root"><\/div>/, `${closed}: без готовой разметки`);
  }
  assert.doesNotMatch(sitemapXml(), /\/(models|docs)/);
  assert.ok(!SEO_PAGES.some((page) => page.feature), 'закрытых страниц нет среди открытых');
  for (const page of SEO_PAGES) {
    assert.ok(page.description.length <= 250, `${page.path}: описание длиннее 250 символов`);
    assert.ok(page.title.length <= 75, `${page.path}: заголовок длиннее 75 символов`);
    if (page.discovery) {
      assert.ok(page.discovery.description.length <= 250, `${page.path}: описание (discovery)`);
      assert.ok(page.discovery.title.length <= 75, `${page.path}: заголовок (discovery)`);
    }
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
  assert.equal(trailingSlashRedirect('/docs/plans/pro/'), null, 'закрытая страница не открытая');
  assert.equal(trailingSlashRedirect('/pricing'), null);
  assert.equal(trailingSlashRedirect('/'), null);
  assert.equal(trailingSlashRedirect('/chat/'), null, 'закрытые разделы не перенаправляются');
  assert.equal(trailingSlashRedirect('/api/'), null);
  assert.equal(trailingSlashRedirect('//evil.example/'), null, 'чужой адрес не подставляется');
});

test('seo: метка возможностей и заголовок главной зависят от флага платформы решений', () => {
  const off = renderIndexHtml(BASE, '/');
  assert.match(off, /<meta name="ketner-features" content="" \/>/);
  // Чат закрыт: главная одна и та же при любом флаге, без посыла агрегатора.
  assert.match(off, /<title>Ketner AI — расскажите о своём бизнесе/);
  assert.doesNotMatch(off, /ChatGPT|Grok|без подписки/);

  const on = renderIndexHtml(BASE, '/', undefined, { discovery: true });
  assert.match(on, /<meta name="ketner-features" content="discovery" \/>/);
  assert.match(on, /<title>Ketner AI — расскажите о своём бизнесе/);
  assert.match(on, /<meta name="description" content="Опишите, чем занимается ваша компания/);
  assert.match(on, /находит, что можно автоматизировать с помощью искусственного интеллекта/);
  assert.doesNotMatch(on, /Плюс чат/);
});

test('seo: Schema.org главной — пакеты кредитов, а не снятые подписки', () => {
  const html = renderIndexHtml(BASE, '/');
  const json = /<script type="application\/ld\+json">([^<]+)<\/script>/.exec(html)?.[1] ?? '';
  const graph = (JSON.parse(json) as { '@graph': Array<Record<string, unknown>> })['@graph'];
  const app = graph.find((node) => node['@type'] === 'WebApplication') as {
    offers: Array<{ name: string; price: string }>;
  };
  assert.deepEqual(
    app.offers.map((offer) => offer.price),
    ['0', '5', '10', '25', '50', '100'],
  );
  assert.ok(!app.offers.some((offer) => /Plus|Pro|Ultra/.test(offer.name)));
});

test('seo: раздел анализов закрыт от индексации', () => {
  assert.equal(classifyPath('/analyses/new'), 'private');
  assert.match(robotsTxt(), /Disallow: \/analyses/);
});
