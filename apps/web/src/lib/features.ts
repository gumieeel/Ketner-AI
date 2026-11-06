/**
 * Включённые на сервере возможности сайта, которые меняют то, что видит пользователь.
 *
 * Сервер пишет их в HTML каждой страницы: `<meta name="ketner-features" content="discovery">`
 * (apps/mock-api/src/seo/pages.ts, флаг `DISCOVERY_ENABLED`). Сайт читает метку при запуске
 * синхронно, поэтому нужная главная показывается сразу, без мигания и без лишнего запроса.
 *
 * Локальная разработка через Vite отдаёт index.html без сервера: там платформа решений включена,
 * пока не задано `VITE_DISCOVERY=false`. В тестах и при предварительной отрисовке значение
 * задаётся явно через `setSiteFeatures`.
 */

export interface SiteFeatures {
  /** Платформа решений: главная «Расскажите о своём бизнесе», анализы задач. */
  discovery: boolean;
  /** Оплата картой подключена: подписка «Автоматизации» (Dodo Payments). */
  cardPayments?: boolean;
}

export const FEATURES_META_NAME = 'ketner-features';

let override: SiteFeatures | null = null;

/** Явно задать возможности (тесты, предварительная отрисовка); `null` — снова читать из страницы. */
export function setSiteFeatures(features: SiteFeatures | null): void {
  override = features;
}

function fromDocument(): SiteFeatures | null {
  if (typeof document === 'undefined') return null;
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${FEATURES_META_NAME}"]`);
  if (!meta) return null;
  const flags = new Set(meta.content.split(/[\s,]+/).filter(Boolean));
  return { discovery: flags.has('discovery'), cardPayments: flags.has('card-payments') };
}

export function siteFeatures(): SiteFeatures {
  if (override) return override;
  const fromPage = fromDocument();
  if (fromPage) return fromPage;
  // Vite в режиме разработки: сервер метку не вставлял.
  if (import.meta.env.MODE === 'development') {
    return { discovery: import.meta.env.VITE_DISCOVERY !== 'false' };
  }
  return { discovery: false };
}
