/** Общие потребности пунктов плейбуков: id каталога или «other» с описанием. */

import type { PlaybookNeed } from './types.js';

/** ИИ-агент для клиентов на странице и в кнопке на сайте. */
export const SITE_AGENT: readonly PlaybookNeed[] = ['customer_bot_page', 'text_generation'];
/** Ответы в мессенджерах клиента (WhatsApp, Instagram, Telegram). */
export const MESSENGERS: PlaybookNeed = 'messengers';
export const CRM: PlaybookNeed = 'crm';
export const SHEET: PlaybookNeed = 'spreadsheets_sync';
/** Запуски по расписанию: напоминания, повторные касания, сводки. */
export const SCHEDULE: PlaybookNeed = 'scheduled_runs';
export const EMAIL: PlaybookNeed = 'email';
export const CALENDAR: PlaybookNeed = {
  other: {
    ru: 'запись в календарь или расписание (онлайн-запись)',
    en: 'booking into a calendar or schedule (online booking)',
  },
};
export const ORDERS: PlaybookNeed = {
  other: {
    ru: 'доступ к заказам и их статусам (магазин, учётная система)',
    en: 'access to orders and their statuses (shop, accounting system)',
  },
};
