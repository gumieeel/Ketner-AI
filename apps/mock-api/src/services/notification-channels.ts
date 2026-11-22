import type { Mailer } from './mailer.js';

/**
 * Строка в лог при старте: настроены ли каналы уведомлений владельцам. Без адресов, хостов и
 * токенов — только вид канала. По ней видно, почему письма или сообщения не уходят.
 */
export function notificationChannelsLine(mailKind: Mailer['kind'], telegramConfigured: boolean) {
  const mail =
    mailKind === 'smtp'
      ? 'почта — SMTP'
      : mailKind === 'console'
        ? 'почта — в лог (не production)'
        : 'почта — НЕ настроена (SMTP_HOST, MAIL_FROM): письма владельцам не уходят';
  const telegram = telegramConfigured
    ? 'Telegram — бот настроен (сообщения — тем, кто привязал Telegram)'
    : 'Telegram — бот НЕ настроен';
  return `[mock-api] уведомления владельцам: ${mail}; ${telegram}`;
}
