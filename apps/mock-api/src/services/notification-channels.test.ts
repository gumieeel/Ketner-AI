import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationChannelsLine } from './notification-channels.js';

test('строка при старте: каналы уведомлений без адресов и хостов', () => {
  assert.equal(
    notificationChannelsLine('none', true),
    '[mock-api] уведомления владельцам: почта — НЕ настроена (SMTP_HOST, MAIL_FROM): письма владельцам не уходят; Telegram — бот настроен (сообщения — тем, кто привязал Telegram)',
  );
  assert.match(
    notificationChannelsLine('smtp', false),
    /почта — SMTP; Telegram — бот НЕ настроен$/,
  );
});
