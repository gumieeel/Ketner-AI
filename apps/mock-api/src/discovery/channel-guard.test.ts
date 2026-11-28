import assert from 'node:assert/strict';
import test from 'node:test';
import { customerChannelsIn, withoutCustomerChannels } from './channel-guard.js';

test('каналы клиента, которых у Ketner нет: русские и английские формулировки', () => {
  const cases: Array<[string, string[]]> = [
    ['ИИ-агент на сайте и в Telegram', ['telegram']],
    ['Telegram-бот для клиентов и виджет на сайте', ['telegram']],
    ['Агент отвечает клиентам в WhatsApp, Instagram и на сайте.', ['whatsapp', 'instagram']],
    ['Отвечать в ватсапе и инстаграме', ['whatsapp', 'instagram']],
    ['Ответы покупателям в чате Kaspi и на Ozon', ['marketplace']],
    ['Сообщения ВКонтакте обрабатываются агентом', ['vk']],
    // «поступает» — не «пост»: это всё ещё канал клиента.
    ['Заявка поступает в WhatsApp, агент отвечает', ['whatsapp']],
    ['Клиенты пишут в канал поддержки в Telegram', ['telegram']],
    ['An AI agent on the website and in Telegram', ['telegram']],
    ['The agent replies to customers in WhatsApp and on Instagram.', ['whatsapp', 'instagram']],
  ];
  for (const [text, expected] of cases) assert.deepEqual(customerChannelsIn(text), expected, text);
});

test('не канал клиента: уведомление владельцу или менеджеру в Telegram и прямое отрицание', () => {
  for (const text of [
    'Заявка с формы → агент уточняет бюджет → менеджер получает уведомление в Telegram.',
    'Уведомление владельцу в Telegram о каждой новой заявке.',
    'Сообщение менеджеру в Telegram, когда клиент оставил контакт.',
    'The manager gets a Telegram notification about every new lead.',
    'Send an alert to the owner in Telegram.',
    'Бот отвечает по ссылке и QR-коду. К WhatsApp и Instagram не подключается.',
    'Агент работает без WhatsApp, только на сайте.',
    'The bot does not connect to WhatsApp or Instagram.',
    'Агент на сайте отвечает на вопросы о ценах.',
    'Посты для Telegram-канала компании по расписанию.',
    'Publish posts to the company Instagram on a schedule.',
  ]) {
    assert.deepEqual(customerChannelsIn(text), [], text);
  }
  // В одном тексте — канал клиента и уведомление менеджеру: найден только канал клиента.
  assert.deepEqual(
    customerChannelsIn('Заявка приходит в WhatsApp. Менеджер получает уведомление в Telegram.'),
    ['whatsapp'],
  );
});

test('убрать канал из текста: перечисление сшивается, уведомления и отрицания остаются', () => {
  const cases: Array<[string, string]> = [
    ['ИИ-агент на сайте и в Telegram', 'ИИ-агент на сайте'],
    [
      'Агент отвечает клиентам в WhatsApp, Instagram и на сайте.',
      'Агент отвечает клиентам на сайте.',
    ],
    ['Telegram-бот для клиентов и виджет на сайте.', 'Бот для клиентов и виджет на сайте.'],
    ['An AI agent on the site and in Telegram', 'An AI agent on the site'],
    [
      'The agent replies in WhatsApp and on the website; the manager gets a Telegram notification.',
      'The agent replies on the website; the manager gets a Telegram notification.',
    ],
    [
      'Агент на сайте. Менеджер получает уведомление в Telegram.',
      'Агент на сайте. Менеджер получает уведомление в Telegram.',
    ],
    ['Бот по ссылке. К WhatsApp не подключается.', 'Бот по ссылке. К WhatsApp не подключается.'],
  ];
  for (const [text, expected] of cases) assert.equal(withoutCustomerChannels(text), expected, text);
});
