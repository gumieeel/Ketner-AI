import { fileURLToPath } from 'node:url';
import { DocStore } from './doc-store.js';

/**
 * Где установлен виджет бота (docs/SUBSCRIPTION_PRICING_DESIGN.md, раздел 10, P10): виджет при
 * открытии страницы сообщает о себе, сервер запоминает адрес сайта (Origin запроса браузера).
 * Хранится только адрес сайта (схема, домен, порт) и время — ни страниц, ни посетителей.
 */
export interface WidgetSite {
  origin: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Документ на адрес бота: сайты, где его виджет открывали. */
export interface WidgetInstall {
  /** Адрес бота (slug). */
  id: string;
  sites: WidgetSite[];
}

/** Сколько сайтов помнить на бота: последние по времени. */
export const WIDGET_SITES_MAX = 5;
/** Отметка того же сайта не чаще: каждая запись уходит и в Postgres. */
export const WIDGET_SEEN_REFRESH_MS = 10 * 60_000;

/** Адрес сайта из Origin или Referer: только http(s), без пути; иначе null. */
export function siteOrigin(raw: string | undefined | null): string | null {
  if (!raw || raw === 'null') return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export class WidgetInstalls {
  constructor(
    readonly store: DocStore<WidgetInstall>,
    private readonly now: () => number = Date.now,
  ) {}

  /** Нужна ли запись: сайт новый или отметка устарела. Проверяется до поиска бота. */
  needsRecord(slug: string, origin: string): boolean {
    const site = this.store.get(slug)?.sites.find((item) => item.origin === origin);
    return !site || this.now() - Date.parse(site.lastSeenAt) >= WIDGET_SEEN_REFRESH_MS;
  }

  /** Запоминает сайт; true — запись изменилась. */
  record(slug: string, origin: string): boolean {
    if (!this.needsRecord(slug, origin)) return false;
    const at = new Date(this.now()).toISOString();
    const doc = this.store.get(slug) ?? { id: slug, sites: [] };
    const existing = doc.sites.find((item) => item.origin === origin);
    const sites = existing
      ? doc.sites.map((item) => (item.origin === origin ? { ...item, lastSeenAt: at } : item))
      : [...doc.sites, { origin, firstSeenAt: at, lastSeenAt: at }];
    sites.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    this.store.put({ id: slug, sites: sites.slice(0, WIDGET_SITES_MAX) });
    return true;
  }

  /** Сайты бота, последний — первым. */
  sitesFor(slug: string): WidgetSite[] {
    return this.store.get(slug)?.sites ?? [];
  }
}

/** Рабочее хранилище: файл на диске плюс зеркало в Postgres (`ketner_docs`, см. db/sync.ts). */
export const widgetInstallStore = new DocStore<WidgetInstall>(
  'widget_installs',
  process.env.WIDGET_INSTALL_STORE_FILE ??
    fileURLToPath(new URL('../../data/widget-installs.json', import.meta.url)),
);

export const widgetInstalls = new WidgetInstalls(widgetInstallStore);
