import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createSupportStore } from '../store/support-store.js';
import { TelegramSupportBotService } from './support-bot.js';
import type { TelegramUpdate } from './bot.js';

/** Бот поддержки, который вместо Telegram складывает отправленные сообщения в массив. */
function makeBot(options: { adminChatId?: number } = {}) {
  const store = createSupportStore(join(mkdtempSync(join(tmpdir(), 'ketner-support-')), 's.json'));
  const bot = new TelegramSupportBotService({
    supportStore: store,
    botToken: '',
    adminUsername: 'boss',
    ...options,
  });
  const sent: Array<{ chatId: number | string; text: string }> = [];
  bot.sendMessage = async (chatId, text) => {
    sent.push({ chatId, text });
    return { message_id: sent.length };
  };
  return { bot, sent, store };
}

function message(chatId: number, text: string, from: { username?: string; first_name: string }) {
  return {
    update_id: Date.now(),
    message: {
      message_id: 1,
      chat: { id: chatId, type: 'private' },
      from: { id: chatId, is_bot: false, ...from },
      date: Math.floor(Date.now() / 1000),
      text,
    },
  } as TelegramUpdate;
}

test('поддержка: имя пользователя в списке тикетов экранируется', async () => {
  const { bot, sent } = makeBot();
  await bot.processUpdate(
    message(501, 'Не проходит оплата', { first_name: '<a href="https://evil.example">Срочно</a>' }),
  );
  await bot.processUpdate(message(900, '/tickets', { username: 'boss', first_name: 'Админ' }));

  const list = sent.find((m) => m.chatId === 900 && m.text.includes('Открытые обращения'));
  assert.ok(list, 'администратор получил список');
  assert.ok(!list.text.includes('<a href'), 'разметка из имени не попадает в сообщение');
  assert.ok(list.text.includes('&lt;a href='));
});

test('поддержка: при закреплённом чате администратора чужой с тем же username прав не получает', async () => {
  const { bot, sent, store } = makeBot({ adminChatId: 900 });
  await bot.processUpdate(message(501, 'Вопрос по тарифу', { first_name: 'Клиент' }));

  // Кто-то занял username администратора.
  const result = await bot.processUpdate(
    message(777, '/tickets', { username: 'boss', first_name: 'Самозванец' }),
  );
  assert.notEqual(result?.action, 'admin_tickets_list_sent');
  assert.equal(String(store.getAdminChatId()), '900');
  assert.ok(!sent.some((m) => m.chatId === 777 && m.text.includes('Открытые обращения')));

  await bot.processUpdate(message(900, '/tickets', { first_name: 'Админ' }));
  assert.ok(sent.some((m) => m.chatId === 900 && m.text.includes('Открытые обращения')));
});
