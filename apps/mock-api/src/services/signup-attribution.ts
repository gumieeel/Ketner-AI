/**
 * Откуда пришёл человек при регистрации.
 *
 * Фронтенд при первом заходе на сайт кладёт в cookie `ketner_src` метки рекламы (utm_*),
 * признак клика из рекламы (gclid / yclid / fbclid), домен внешнего сайта-источника и страницу
 * входа. Сервер читает cookie в момент создания аккаунта — одинаково для регистрации по почте
 * и для входа через Google / GitHub, где аккаунт создаётся при первом запросе после редиректа.
 *
 * Значение приходит от клиента, поэтому каждое поле чистится и обрезается: в админке это
 * просто подписи, но доверять им как фактам нельзя.
 */

export type SignupMethod = 'email' | 'google' | 'github' | 'telegram' | 'admin' | 'unknown';

export const SIGNUP_METHODS: readonly SignupMethod[] = [
  'email',
  'google',
  'github',
  'telegram',
  'admin',
  'unknown',
];

export interface SignupAttribution {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  /** Метка клика из рекламной системы (сам идентификатор не храним). */
  clickId?: 'gclid' | 'yclid' | 'fbclid';
  /** Домен внешнего сайта, с которого пришли (без пути). */
  referrer?: string;
  /** Страница сайта, на которую пришли (без query). */
  landing?: string;
  /** Когда метка была записана (ISO). */
  at?: string;
}

/** Канал привлечения — крупная группа, по которой удобно сравнивать источники. */
export type SignupChannel =
  'paid' | 'organic' | 'social' | 'referral' | 'email' | 'campaign' | 'direct' | 'unknown';

export interface ClassifiedSource {
  channel: SignupChannel;
  /** Нормализованное имя источника: google, yandex, telegram, habr.com… Пусто для direct / unknown. */
  source: string;
}

export const ATTRIBUTION_COOKIE = 'ketner_src';

const MAX_FIELD = 100;
const MAX_COOKIE = 2000;
const HOST_PATTERN = /^(?=.{1,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const OWN_HOSTS = [/(^|\.)ketner\.org$/, /\.onrender\.com$/, /^localhost$/];
/** Возврат со входа через провайдера или со страницы оплаты — не источник посетителя. */
const SERVICE_HOSTS = [
  /^accounts\.google\.[a-z.]+$/,
  /^accounts\.youtube\.com$/,
  /^oauth\.telegram\.org$/,
  /(^|\.)trybit\.com$/,
  /(^|\.)cryptocloud\.plus$/,
  /^checkout\.stripe\.com$/,
];

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Без управляющих символов и угловых скобок: это подписи в админке, не разметка.
  const cleaned = Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f && !'<>"`'.includes(char);
    })
    .join('')
    .trim()
    .slice(0, MAX_FIELD);
  return cleaned || undefined;
}

function cleanHost(value: unknown): string | undefined {
  const text = cleanText(value)
    ?.toLowerCase()
    .replace(/^www\./, '');
  if (!text || !HOST_PATTERN.test(text)) return undefined;
  if (OWN_HOSTS.some((pattern) => pattern.test(text))) return undefined;
  if (SERVICE_HOSTS.some((pattern) => pattern.test(text))) return undefined;
  return text;
}

function cleanPath(value: unknown): string | undefined {
  const text = cleanText(value);
  if (!text || !text.startsWith('/')) return undefined;
  return text.split(/[?#]/)[0]?.slice(0, 120) || undefined;
}

/** Приводит произвольный объект к безопасной метке источника или возвращает undefined. */
export function sanitizeAttribution(raw: unknown): SignupAttribution | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const input = raw as Record<string, unknown>;
  const result: SignupAttribution = {};
  const lower = (value: unknown) => cleanText(value)?.toLowerCase();

  const utmSource = lower(input.utmSource);
  const utmMedium = lower(input.utmMedium);
  const utmCampaign = cleanText(input.utmCampaign);
  const utmContent = cleanText(input.utmContent);
  const utmTerm = cleanText(input.utmTerm);
  if (utmSource) result.utmSource = utmSource;
  if (utmMedium) result.utmMedium = utmMedium;
  if (utmCampaign) result.utmCampaign = utmCampaign;
  if (utmContent) result.utmContent = utmContent;
  if (utmTerm) result.utmTerm = utmTerm;

  if (input.clickId === 'gclid' || input.clickId === 'yclid' || input.clickId === 'fbclid') {
    result.clickId = input.clickId;
  }
  const referrer = cleanHost(input.referrer);
  if (referrer) result.referrer = referrer;
  const landing = cleanPath(input.landing);
  if (landing) result.landing = landing;
  if (typeof input.at === 'string' && Number.isFinite(Date.parse(input.at))) {
    result.at = new Date(input.at).toISOString();
  }
  return result;
}

/** Достаёт метку источника из заголовка Cookie запроса. */
export function attributionFromCookieHeader(
  header: string | string[] | undefined,
): SignupAttribution | undefined {
  const value = Array.isArray(header) ? header.join('; ') : header;
  if (!value) return undefined;
  for (const part of value.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== ATTRIBUTION_COOKIE) continue;
    const encoded = part.slice(index + 1).trim();
    if (!encoded || encoded.length > MAX_COOKIE) return undefined;
    try {
      return sanitizeAttribution(JSON.parse(decodeURIComponent(encoded)));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const SEARCH_ENGINES: Array<[RegExp, string]> = [
  [/(^|\.)google\.[a-z.]+$/, 'google'],
  [/(^|\.)yandex\.[a-z.]+$/, 'yandex'],
  [/(^|\.)ya\.ru$/, 'yandex'],
  [/(^|\.)bing\.com$/, 'bing'],
  [/(^|\.)duckduckgo\.com$/, 'duckduckgo'],
  [/(^|\.)yahoo\.com$/, 'yahoo'],
  [/(^|\.)ecosia\.org$/, 'ecosia'],
  [/^go\.mail\.ru$/, 'mail.ru'],
  [/(^|\.)perplexity\.ai$/, 'perplexity'],
  [/(^|\.)chatgpt\.com$/, 'chatgpt'],
];

const SOCIAL_NETWORKS: Array<[RegExp, string]> = [
  [/(^|\.)t\.me$/, 'telegram'],
  [/(^|\.)telegram\.(org|me)$/, 'telegram'],
  [/(^|\.)vk\.(com|ru)$/, 'vk'],
  [/(^|\.)youtube\.com$/, 'youtube'],
  [/(^|\.)youtu\.be$/, 'youtube'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)facebook\.com$/, 'facebook'],
  [/(^|\.)(x|twitter)\.com$/, 'x'],
  [/^t\.co$/, 'x'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)reddit\.com$/, 'reddit'],
  [/(^|\.)dzen\.ru$/, 'dzen'],
  [/(^|\.)linkedin\.com$/, 'linkedin'],
  [/(^|\.)threads\.net$/, 'threads'],
];

const SOCIAL_SOURCES = new Set(SOCIAL_NETWORKS.map(([, name]) => name).concat(['tg', 'fb', 'ig']));
const PAID_MEDIUMS =
  /^(cpc|ppc|cpm|cpa|cpv|paid|paid[_-]?search|paid[_-]?social|display|ads?|banner|retargeting)$/;
const CLICK_SOURCES: Record<NonNullable<SignupAttribution['clickId']>, string> = {
  gclid: 'google',
  yclid: 'yandex',
  fbclid: 'facebook',
};

function match(host: string, table: Array<[RegExp, string]>): string | undefined {
  return table.find(([pattern]) => pattern.test(host))?.[1];
}

/**
 * Канал и источник для группировки. Без метки (аккаунты до появления учёта) — `unknown`;
 * метка без utm и без внешнего сайта — прямой заход.
 */
export function classifyAttribution(attribution: SignupAttribution | undefined): ClassifiedSource {
  if (!attribution) return { channel: 'unknown', source: '' };
  const { utmSource, utmMedium, clickId, referrer } = attribution;

  if (utmSource || utmMedium) {
    const source = utmSource || (referrer ? (match(referrer, SEARCH_ENGINES) ?? referrer) : '');
    const medium = utmMedium ?? '';
    if (PAID_MEDIUMS.test(medium) || clickId) {
      return { channel: 'paid', source: source || (clickId ? CLICK_SOURCES[clickId] : '') };
    }
    if (medium === 'organic') return { channel: 'organic', source };
    if (medium.includes('social') || SOCIAL_SOURCES.has(source)) {
      return { channel: 'social', source };
    }
    if (medium === 'email' || medium === 'newsletter') return { channel: 'email', source };
    if (medium === 'referral') return { channel: 'referral', source };
    return { channel: 'campaign', source };
  }

  if (clickId) return { channel: 'paid', source: CLICK_SOURCES[clickId] };

  if (referrer) {
    const engine = match(referrer, SEARCH_ENGINES);
    if (engine) return { channel: 'organic', source: engine };
    const network = match(referrer, SOCIAL_NETWORKS);
    if (network) return { channel: 'social', source: network };
    return { channel: 'referral', source: referrer };
  }

  return { channel: 'direct', source: '' };
}
