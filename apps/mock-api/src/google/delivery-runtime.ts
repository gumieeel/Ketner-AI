/**
 * Сборка доставки в Google Таблицу для сервера (routes/index.ts) и тестов: хранилища платформы,
 * подключения, письмо и Telegram владельцу о поломке, обход раз в минуту.
 */

import type { DiscoveryStores } from '../discovery/runtime.js';
import { googleSheetsEnabledFor, googleSheetsEnabledForAnyone } from '../product-switches.js';
import type { Mailer } from '../services/mailer.js';
import type { GoogleConnectionStore } from './connection-store.js';
import { PostgresDeliveryJournal } from './delivery-journal.js';
import { SheetsDelivery } from './delivery.js';
import type { GoogleOAuthSettings } from './oauth.js';

export interface SheetsDeliveryRuntimeDeps {
  stores: () => DiscoveryStores | null;
  connections: GoogleConnectionStore;
  settings: () => GoogleOAuthSettings | null;
  siteUrl: () => string;
  /** Почта владельца по id аккаунта. */
  ownerEmail: (userId: string) => string | null;
  mailer?: Mailer;
  telegram?: {
    canNotify: (userId: string) => boolean;
    notifyOwner: (userId: string, text: string) => Promise<unknown>;
  };
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (message: string) => void;
}

export function brokenConnectionText(
  status: 'reconnect_required' | 'sheet_missing',
  link: string,
): { subject: string; text: string } {
  return status === 'reconnect_required'
    ? {
        subject: 'Заявки не записываются в Google Таблицу',
        text: [
          'Ketner не может записывать заявки в вашу Google Таблицу: доступ к Google отозван или устарел.',
          'Новые заявки сохраняются в Ketner и приходят письмом, в таблицу они запишутся после подключения.',
          `Подключите таблицу снова в кабинете бота, раздел «Заявки»: ${link}`,
        ].join('\n'),
      }
    : {
        subject: 'Google Таблица с заявками удалена',
        text: [
          'Таблица «Заявки Ketner» удалена или лежит в корзине Google Диска.',
          'Новые заявки сохраняются в Ketner и приходят письмом.',
          `Создайте новую таблицу или отключите запись в кабинете бота, раздел «Заявки»: ${link}`,
        ].join('\n'),
      };
}

export function createSheetsDelivery(deps: SheetsDeliveryRuntimeDeps): SheetsDelivery {
  return new SheetsDelivery({
    journal: () => deps.stores()?.deliveries ?? null,
    leads: () => deps.stores()?.builder ?? null,
    connections: deps.connections,
    settings: deps.settings,
    enabled: (userId) =>
      userId === undefined ? googleSheetsEnabledForAnyone() : googleSheetsEnabledFor(userId),
    siteUrl: deps.siteUrl,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.log ? { log: deps.log } : {}),
    notifyBroken: async (userId, status) => {
      const { subject, text } = brokenConnectionText(status, `${deps.siteUrl()}/solutions`);
      const email = deps.ownerEmail(userId);
      if (email && deps.mailer && deps.mailer.kind !== 'none') {
        const escape = (value: string) =>
          value.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
        await deps.mailer.send({
          to: email,
          subject,
          text,
          html: text
            .split('\n')
            .map((line) => `<p>${escape(line)}</p>`)
            .join(''),
        });
      }
      if (deps.telegram?.canNotify(userId)) await deps.telegram.notifyOwner(userId, text);
    },
  });
}

let sweepTimer: NodeJS.Timeout | null = null;

/**
 * Обход раз в минуту — только с журналом в Postgres (как reaper исполнений): в памяти нет
 * нескольких процессов и перезапусков, а тесты вызывают `sweep()` сами.
 */
export function startSheetsSweep(
  delivery: SheetsDelivery,
  stores: () => DiscoveryStores | null,
  intervalMs = 60_000,
): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    if (!delivery.available()) return;
    if (!(stores()?.deliveries instanceof PostgresDeliveryJournal)) return;
    delivery.sweep().catch((error: unknown) => {
      console.error('[sheets] обход доставки не выполнен:', error);
    });
  }, intervalMs);
  sweepTimer.unref();
}
