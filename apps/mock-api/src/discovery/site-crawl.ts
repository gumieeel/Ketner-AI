/**
 * Чтение сайта: главная и до 9 внутренних страниц того же сайта (docs/ANALYSIS_V2.md, раздел 1).
 *
 * Порядок: `robots.txt` (соблюдается `Disallow` для `User-agent: *`, берутся строки `Sitemap:`) →
 * главная → список страниц из карты сайта, иначе ссылки из `<nav>`, `<header>` и `<footer>` главной
 * → отбор по группам (услуги, о компании, контакты, вопросы, запись и доставка) → чтение.
 *
 * Каждый запрос — через `fetchResource` (site-reader.ts): только http(s) на 80/443, адрес
 * проверяется при каждом соединении, внутренние адреса запрещены, переадресации проверяются заново,
 * переадресация на другой сайт — страница пропускается. Общие лимиты: страниц, одновременных
 * запросов, времени, байт и текста для модели.
 */

import {
  decode,
  extractPage,
  fetchResource,
  isHtml,
  type SiteResult,
  type SiteReaderOptions,
} from './site-reader.js';
import { extractFacts, type SiteFact } from './site-facts.js';

export interface CrawlOptions extends SiteReaderOptions {
  maxPages?: number;
  concurrency?: number;
  /** Общее время чтения, мс. */
  totalMs?: number;
  /** Всего байт со всех запросов. */
  totalBytes?: number;
  /** Текста с одной страницы для модели. */
  pageChars?: number;
  /** Текста сайта для модели всего. */
  totalChars?: number;
  now?: () => number;
}

export const CRAWL_LIMITS = {
  maxPages: 10,
  concurrency: 3,
  totalMs: 20_000,
  totalBytes: 6_000_000,
  pageChars: 4_000,
  totalChars: 16_000,
  sitemapBytes: 300_000,
  sitemapUrls: 500,
  robotsBytes: 100_000,
  perGroup: 2,
} as const;

export interface CrawledPage {
  path: string;
  title: string;
}

export type CrawlResult =
  | (Extract<SiteResult, { ok: true }> & { pages: CrawledPage[]; facts: SiteFact[] })
  | Extract<SiteResult, { ok: false }>;

/** Группы страниц по словам в адресе и тексте ссылки, в порядке важности. */
const GROUPS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  {
    id: 'services',
    pattern: /услуг|services?|прайс|цен[аы]|price|pricing|стоимост|каталог|catalog|menu|меню/i,
  },
  { id: 'about', pattern: /о-нас|о нас|о-компании|о компании|about|команд|team|kompaniya|o-nas/i },
  { id: 'contacts', pattern: /контакт|contact|адрес|как-добраться|как добраться|kontakt/i },
  { id: 'faq', pattern: /faq|вопрос|помощь|help|voprosy/i },
  {
    id: 'booking',
    pattern: /запис|booking|book|онлайн-запись|доставк|delivery|оплат|payment|zapis|dostavka/i,
  },
];

const SKIP_EXTENSION =
  /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|rar|7z|docx?|xlsx?|pptx?|mp4|mp3|avi|mov|xml|json|txt|css|js)$/i;
const SKIP_PATH =
  /(^|\/)(login|signin|sign-in|logout|register|signup|auth|account|cabinet|lk|cart|basket|korzina|корзина|checkout|wp-admin|wp-login|admin)(\/|$)/i;

const stripWww = (host: string) => host.toLowerCase().replace(/^www\./, '');

interface RobotsRules {
  disallow: string[];
  allow: string[];
  sitemaps: string[];
}

/** `robots.txt`: правила для `User-agent: *` и строки `Sitemap:`. */
export function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [], sitemaps: [] };
  let agents: string[] = [];
  let inRules = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'sitemap') {
      if (value) rules.sitemaps.push(value);
      continue;
    }
    if (key === 'user-agent') {
      if (inRules) {
        agents = [];
        inRules = false;
      }
      agents.push(value.toLowerCase());
      continue;
    }
    if (key !== 'disallow' && key !== 'allow') continue;
    inRules = true;
    if (!agents.includes('*') || !value) continue;
    (key === 'disallow' ? rules.disallow : rules.allow).push(value);
  }
  return rules;
}

/** Разрешён ли путь: самое длинное совпавшее правило; `Allow` побеждает при равной длине. */
export function robotsAllows(rules: RobotsRules, path: string): boolean {
  const matches = (rule: string) => {
    const pattern = rule
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\\\$$/, '$');
    return new RegExp(`^${pattern}`).test(path);
  };
  const longest = (list: string[]) =>
    list.filter(matches).reduce((max, rule) => Math.max(max, rule.length), -1);
  const deny = longest(rules.disallow);
  if (deny < 0) return true;
  return longest(rules.allow) >= deny;
}

/** Ссылки из навигации главной (`<nav>`, `<header>`, `<footer>`); нет их — все ссылки страницы. */
export function navigationLinks(html: string): Array<{ href: string; text: string }> {
  const blocks = html.match(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi) ?? [];
  const source = blocks.length > 0 ? blocks.join('\n') : html;
  const links: Array<{ href: string; text: string }> = [];
  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[1] ?? '');
    const value = href?.[2] ?? href?.[3] ?? href?.[4];
    if (!value) continue;
    links.push({
      href: value,
      text: (match[2] ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    });
  }
  return links;
}

/** Адреса из карты сайта (`<loc>`) и вложенные карты (`<sitemapindex>`). */
export function sitemapLocations(xml: string): { pages: string[]; children: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((match) =>
    (match[1] ?? '').replace(/&amp;/g, '&'),
  );
  return /<sitemapindex\b/i.test(xml)
    ? { pages: [], children: locs }
    : { pages: locs, children: [] };
}

/** Отбор страниц: до двух на группу по порядку групп, затем остальные по порядку. */
export function choosePages(
  candidates: ReadonlyArray<{ url: string; text: string }>,
  limit: number,
): string[] {
  const chosen: string[] = [];
  const taken = new Set<string>();
  for (const group of GROUPS) {
    let count = 0;
    for (const candidate of candidates) {
      if (chosen.length >= limit || count >= CRAWL_LIMITS.perGroup) break;
      if (taken.has(candidate.url)) continue;
      const path = decodeURIComponent(new URL(candidate.url).pathname);
      if (group.pattern.test(`${path} ${candidate.text}`)) {
        chosen.push(candidate.url);
        taken.add(candidate.url);
        count += 1;
      }
    }
  }
  for (const candidate of candidates) {
    if (chosen.length >= limit) break;
    if (!taken.has(candidate.url)) {
      chosen.push(candidate.url);
      taken.add(candidate.url);
    }
  }
  return chosen;
}

const pathOf = (url: string) => {
  const parsed = new URL(url);
  return decodeURIComponent(parsed.pathname) || '/';
};

export async function crawlSite(
  address: string,
  overrides: CrawlOptions = {},
): Promise<CrawlResult> {
  const limits = { ...CRAWL_LIMITS, ...overrides };
  const now = overrides.now ?? Date.now;
  const started = now();
  const reader: SiteReaderOptions = {
    ...(overrides.allowPrivate !== undefined ? { allowPrivate: overrides.allowPrivate } : {}),
    ...(overrides.maxRedirects !== undefined ? { maxRedirects: overrides.maxRedirects } : {}),
    ...(overrides.maxBytes !== undefined ? { maxBytes: overrides.maxBytes } : {}),
  };
  const timeLeft = () => limits.totalMs - (now() - started);
  const timeout = () => Math.max(500, Math.min(overrides.timeoutMs ?? 8_000, timeLeft()));
  let bytes = 0;

  let start: URL;
  try {
    start = new URL(address);
  } catch {
    return { ok: false, url: address, reason: 'unreachable' };
  }
  const baseHost = stripWww(start.hostname);
  const sameSite = (url: URL) =>
    (url.protocol === 'http:' || url.protocol === 'https:') && stripWww(url.hostname) === baseHost;

  // 1. robots.txt того же сайта (нет файла — ограничений нет).
  let robots: RobotsRules = { disallow: [], allow: [], sitemaps: [] };
  const robotsFetch = await fetchResource(
    new URL('/robots.txt', start).toString(),
    { ...reader, maxBytes: limits.robotsBytes, timeoutMs: timeout() },
    { accept: 'text/plain,*/*;q=0.5', sameSite },
  );
  if (robotsFetch.ok) {
    bytes += robotsFetch.body.length;
    robots = parseRobots(decode(robotsFetch.body, robotsFetch.contentType));
  }
  if (!robotsAllows(robots, start.pathname || '/')) {
    return { ok: false, url: start.toString(), reason: 'blocked' };
  }

  // 2. Главная — как раньше (переадресация на другой адрес главной допустима).
  const home = await fetchResource(start.toString(), { ...reader, timeoutMs: timeout() });
  if (!home.ok) return home;
  if (!isHtml(home.contentType)) return { ok: false, url: home.url, reason: 'not_html' };
  bytes += home.body.length;
  const homeUrl = new URL(home.url);
  const homeHtml = decode(home.body, home.contentType);
  const homePage = extractPage(homeHtml, limits.pageChars);
  if (!homePage.title && !homePage.description && homePage.text.length < 40) {
    return { ok: false, url: home.url, reason: 'empty' };
  }
  const homeHost = stripWww(homeUrl.hostname);
  const onSite = (url: URL) =>
    (url.protocol === 'http:' || url.protocol === 'https:') && stripWww(url.hostname) === homeHost;

  // 3. Кандидаты: карта сайта, иначе навигация главной.
  const normalize = (raw: string, base: URL): string | null => {
    let url: URL;
    try {
      url = new URL(raw, base);
    } catch {
      return null;
    }
    if (!onSite(url)) return null;
    url.hash = '';
    url.search = '';
    const path = decodeURIComponent(url.pathname);
    if (SKIP_EXTENSION.test(path) || SKIP_PATH.test(path)) return null;
    if (path === pathOf(home.url) || path === '/' || path === '') return null;
    if (!robotsAllows(robots, url.pathname)) return null;
    return url.toString();
  };
  const navText = new Map<string, string>();
  for (const link of navigationLinks(homeHtml)) {
    const url = normalize(link.href, homeUrl);
    if (url && !navText.has(url)) navText.set(url, link.text);
  }

  const sitemapUrls: string[] = [];
  const readSitemap = async (address: string): Promise<{ pages: string[]; children: string[] }> => {
    if (timeLeft() <= 0 || bytes >= limits.totalBytes) return { pages: [], children: [] };
    const fetched = await fetchResource(
      address,
      { ...reader, maxBytes: limits.sitemapBytes, timeoutMs: timeout() },
      { accept: 'application/xml,text/xml,*/*;q=0.5', sameSite: onSite },
    );
    if (!fetched.ok) return { pages: [], children: [] };
    bytes += fetched.body.length;
    return sitemapLocations(decode(fetched.body, fetched.contentType));
  };
  // Карты из robots.txt и вложенные карты — только того же сайта (хост или его вариант с www.),
  // как страницы; карты на другом хосте не запрашиваются. Своих не осталось — /sitemap.xml.
  const sameSiteMap = (address: string) => {
    try {
      return onSite(new URL(address, homeUrl));
    } catch {
      return false;
    }
  };
  const listed = robots.sitemaps.filter(sameSiteMap);
  const maps = listed.length > 0 ? listed : [new URL('/sitemap.xml', homeUrl).toString()];
  for (const map of maps.slice(0, 3)) {
    const found = await readSitemap(new URL(map, homeUrl).toString());
    sitemapUrls.push(...found.pages);
    for (const child of found.children.filter(sameSiteMap).slice(0, 3))
      sitemapUrls.push(...(await readSitemap(new URL(child, homeUrl).toString())).pages);
    if (sitemapUrls.length >= CRAWL_LIMITS.sitemapUrls) break;
  }

  const candidates: Array<{ url: string; text: string }> = [];
  const seen = new Set<string>();
  const addCandidate = (url: string | null, text: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push({ url, text });
  };
  // Ссылки навигации — первыми: их владелец сайта считает главными.
  for (const [url, text] of navText) addCandidate(url, text);
  for (const raw of sitemapUrls.slice(0, CRAWL_LIMITS.sitemapUrls))
    addCandidate(normalize(raw, homeUrl), '');
  const chosen = choosePages(candidates, limits.maxPages - 1);

  // 4. Чтение страниц: до `concurrency` одновременно, в пределах времени и байт.
  const pages: Array<{ path: string; title: string; text: string; html: string } | null> =
    chosen.map(() => null);
  let next = 0;
  const worker = async () => {
    while (next < chosen.length) {
      const index = next;
      next += 1;
      if (timeLeft() <= 0 || bytes >= limits.totalBytes) return;
      const fetched = await fetchResource(
        chosen[index]!,
        { ...reader, timeoutMs: timeout() },
        { sameSite: onSite },
      );
      if (!fetched.ok || !isHtml(fetched.contentType)) continue;
      bytes += fetched.body.length;
      if (bytes > limits.totalBytes) return;
      const html = decode(fetched.body, fetched.contentType);
      const page = extractPage(html, limits.pageChars);
      if (!page.title && page.text.length < 40) continue;
      pages[index] = { path: pathOf(fetched.url), title: page.title, text: page.text, html };
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, limits.concurrency) }, worker));

  // 5. Текст для модели и факты — главная первой, затем страницы в порядке отбора.
  const read = [
    { path: pathOf(home.url), title: homePage.title, text: homePage.text, html: homeHtml },
    ...pages.filter((page): page is NonNullable<typeof page> => page !== null),
  ];
  const facts: SiteFact[] = [];
  for (const page of read) {
    for (const fact of extractFacts(page.html, page.path)) {
      if (!facts.some((item) => item.kind === fact.kind && item.value === fact.value))
        facts.push(fact);
    }
  }
  let text = '';
  for (const page of read) {
    const block = `## ${page.path}${page.title ? ` — ${page.title}` : ''}\n${page.text}\n\n`;
    const room = limits.totalChars - text.length;
    if (room <= 200) break;
    text += block.length > room ? `${block.slice(0, room - 1)}…` : block;
  }
  return {
    ok: true,
    url: home.url,
    title: homePage.title,
    description: homePage.description,
    text: text.trim(),
    pages: read.map((page) => ({ path: page.path, title: page.title })),
    facts: facts.slice(0, 60),
  };
}
