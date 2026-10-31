/**
 * Ссылка на сайт в описании задачи: «вот мой магазин lisa.kz» или «https://shop.example.com».
 *
 * Голый домен узнаётся только с распространённой доменной зоной, чтобы «Node.js» или «и т.д.» не
 * стали адресом. Схема и `www.` распознаются всегда. Возвращается адрес с https:// по умолчанию.
 */

const COMMON_TLDS = [
  'com',
  'ru',
  'kz',
  'by',
  'uz',
  'ua',
  'kg',
  'am',
  'ge',
  'az',
  'md',
  'tj',
  'tm',
  'net',
  'org',
  'io',
  'co',
  'me',
  'app',
  'dev',
  'ai',
  'info',
  'biz',
  'pro',
  'online',
  'site',
  'store',
  'shop',
  'su',
  'eu',
  'de',
  'uk',
  'us',
  'pl',
  'tr',
  'рф',
  'бел',
  'қаз',
];

const WITH_SCHEME = /\bhttps?:\/\/[^\s<>"'«»]+/i;
const BARE = new RegExp(
  `(^|[\\s(«"'])((?:www\\.)?(?:[a-z0-9а-яё](?:[a-z0-9а-яё-]{0,61}[a-z0-9а-яё])?\\.)+(?:${COMMON_TLDS.join('|')}))(\\/[^\\s<>"'«»]*)?(?=$|[\\s),.!?;:»"'])`,
  'iu',
);

/** Первая ссылка в тексте как URL с http(s), или null. Почта (`me@shop.kz`) ссылкой не считается. */
export function findSiteUrl(text: string): string | null {
  const explicit = WITH_SCHEME.exec(text);
  const candidate = explicit
    ? explicit[0].replace(/[),.!?;:]+$/, '')
    : (() => {
        const match = BARE.exec(text);
        return match ? `https://${match[2]}${match[3] ?? ''}`.replace(/[),.!?;:]+$/, '') : null;
      })();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}
