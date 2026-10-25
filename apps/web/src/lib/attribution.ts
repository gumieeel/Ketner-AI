/**
 * Откуда пришёл посетитель: метки рекламы (utm_*), клик из рекламы (gclid / yclid / fbclid),
 * внешний сайт-источник и страница входа.
 *
 * Сохраняется в cookie `ketner_src` на 90 дней; сервер читает её в момент создания аккаунта
 * (регистрация по почте или первый вход через Google / GitHub) и показывает в админке.
 *
 * Правило — «последний непрямой переход»: новый заход по рекламе или с другого сайта заменяет
 * прежнюю метку, а прямой заход (из закладки, набранный адрес) прежнюю метку не стирает.
 */

export const ATTRIBUTION_COOKIE = 'ketner_src';
const MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
const MAX_FIELD = 100;
const OWN_HOSTS = [/(^|\.)ketner\.org$/, /\.onrender\.com$/, /^localhost$/, /^127\.0\.0\.1$/];
const CLICK_IDS = ['gclid', 'yclid', 'fbclid'] as const;
/** Возврат со входа через провайдера или со страницы оплаты — не источник посетителя. */
const SERVICE_HOSTS = [
  /^accounts\.google\.[a-z.]+$/,
  /^accounts\.youtube\.com$/,
  /^oauth\.telegram\.org$/,
  /(^|\.)trybit\.com$/,
  /(^|\.)cryptocloud\.plus$/,
  /^checkout\.stripe\.com$/,
];
/** Может быть и настоящим источником (ссылка в README), и возвратом со входа через GitHub. */
const SOFT_HOSTS = [/^github\.com$/];

export interface Attribution {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  clickId?: (typeof CLICK_IDS)[number];
  referrer?: string;
  landing?: string;
  at?: string;
}

interface CaptureInput {
  href: string;
  referrer: string;
  cookie: string;
  now?: Date;
}

function clip(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, MAX_FIELD) : undefined;
}

export function readAttributionCookie(cookie: string): Attribution | null {
  for (const part of cookie.split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== ATTRIBUTION_COOKIE) continue;
    try {
      const parsed: unknown = JSON.parse(decodeURIComponent(part.slice(index + 1).trim()));
      return parsed && typeof parsed === 'object' ? (parsed as Attribution) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function externalHost(referrer: string, ownHost: string): string | undefined {
  if (!referrer) return undefined;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
    if (!host || host === ownHost.replace(/^www\./, '')) return undefined;
    if (OWN_HOSTS.some((pattern) => pattern.test(host))) return undefined;
    if (SERVICE_HOSTS.some((pattern) => pattern.test(host))) return undefined;
    return host;
  } catch {
    return undefined;
  }
}

/**
 * Какую метку записать для этого захода; null — оставить как есть.
 * Чистая функция, чтобы правило было легко проверить тестом.
 */
export function nextAttribution({
  href,
  referrer,
  cookie,
  now = new Date(),
}: CaptureInput): Attribution | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const params = url.searchParams;
  const current: Attribution = {
    utmSource: clip(params.get('utm_source')),
    utmMedium: clip(params.get('utm_medium')),
    utmCampaign: clip(params.get('utm_campaign')),
    utmContent: clip(params.get('utm_content')),
    utmTerm: clip(params.get('utm_term')),
    clickId: CLICK_IDS.find((id) => params.has(id)),
    referrer: externalHost(referrer, url.hostname),
    landing: url.pathname.slice(0, 120) || '/',
    at: now.toISOString(),
  };
  for (const key of Object.keys(current) as Array<keyof Attribution>) {
    if (current[key] === undefined) delete current[key];
  }

  const isCampaign = Boolean(current.utmSource || current.utmMedium || current.clickId);
  const existing = readAttributionCookie(cookie);
  if (isCampaign) return current;
  if (current.referrer && !SOFT_HOSTS.some((pattern) => pattern.test(current.referrer!))) {
    return current;
  }
  // Прямой заход или возврат с GitHub: пишем только если метки ещё нет вовсе.
  return existing ? null : current;
}

/** Вызывается один раз при загрузке приложения. */
export function captureAttribution(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  try {
    const next = nextAttribution({
      href: window.location.href,
      referrer: document.referrer,
      cookie: document.cookie,
    });
    if (!next) return;
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${ATTRIBUTION_COOKIE}=${encodeURIComponent(JSON.stringify(next))}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  } catch {
    // Учёт источника не должен мешать сайту
  }
}
