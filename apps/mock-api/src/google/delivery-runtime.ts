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
  /** Часовой пояс владельца для даты в таблице. */
  timeZoneOf?: (userId: string) => string | null;
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

/** Итог одного канала уведомления — для строки в логе и тестов. Адрес не входит. */
export type NoticeResult =
  | 'sent'
  | 'mail_not_configured'
  | 'no_email'
  | 'telegram_not_configured'
  | 'telegram_not_linked'
  | `failed:${string}`;

/** Код ошибки отправки без текста: в тексте SMTP бывает адрес получателя. */
function failureCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code)) return code;
  if (error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name)) return error.name;
  return 'error';
}

const NOTICE_LOG_TEXT: Record<string, string> = {
  sent: 'отправлено',
  mail_not_configured: 'не отправлено: почта на сервере не настроена (SMTP_HOST, MAIL_FROM)',
  no_email: 'не отправлено: у аккаунта нет адреса почты',
  telegram_not_configured: 'не отправлено: Telegram на сервере не подключён',
  telegram_not_linked: 'не отправлено: Telegram не привязан к аккаунту или бот не настроен',
};

function noticeLogText(result: NoticeResult): string {
  return result.startsWith('failed:')
    ? `ошибка отправки (${result.slice('failed:'.length)})`
    : (NOTICE_LOG_TEXT[result] ?? result);
}

/**
 * Письмо и Telegram владельцу о поломке (доступ отозван, таблица пропала). Каналы независимы: сбой
 * письма не мешает Telegram. По строке в логе на каждый канал — канал и итог, без адреса и текста
 * ошибки: «уведомление владельцу <id> (sheet_missing): письмо — отправлено».
 */
export async function notifyBrokenConnection(
  deps: Pick<SheetsDeliveryRuntimeDeps, 'siteUrl' | 'ownerEmail' | 'mailer' | 'telegram' | 'log'>,
  userId: string,
  status: 'reconnect_required' | 'sheet_missing',
): Promise<{ email: NoticeResult; telegram: NoticeResult }> {
  const log = deps.log ?? ((message: string) => console.warn(message));
  const { subject, text } = brokenConnectionText(status, `${deps.siteUrl()}/solutions`);
  const line = (channel: string, result: NoticeResult) =>
    log(
      `[sheets] уведомление владельцу ${userId} (${status}): ${channel} — ${noticeLogText(result)}`,
    );

  let email: NoticeResult;
  const address = deps.ownerEmail(userId);
  if (!deps.mailer || deps.mailer.kind === 'none') {
    email = 'mail_not_configured';
  } else if (!address) {
    email = 'no_email';
  } else {
    const escape = (value: string) =>
      value.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
    try {
      await deps.mailer.send({
        to: address,
        subject,
        text,
        html: text
          .split('\n')
          .map((part) => `<p>${escape(part)}</p>`)
          .join(''),
      });
      email = 'sent';
    } catch (error) {
      email = `failed:${failureCode(error)}`;
    }
  }
  line('письмо', email);

  let telegram: NoticeResult;
  if (!deps.telegram) {
    telegram = 'telegram_not_configured';
  } else if (!deps.telegram.canNotify(userId)) {
    telegram = 'telegram_not_linked';
  } else {
    try {
      await deps.telegram.notifyOwner(userId, text);
      telegram = 'sent';
    } catch (error) {
      telegram = `failed:${failureCode(error)}`;
    }
  }
  line('Telegram', telegram);
  return { email, telegram };
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
    ...(deps.timeZoneOf ? { timeZoneOf: deps.timeZoneOf } : {}),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.log ? { log: deps.log } : {}),
    notifyBroken: async (userId, status) => {
      await notifyBrokenConnection(deps, userId, status);
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
