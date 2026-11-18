import assert from 'node:assert/strict';
import test from 'node:test';
import { customerBotOffer, joinNames } from './customer-bot-offer.js';

test('каналы перечисляются через «и» / «and» перед последним', () => {
  assert.equal(joinNames(['WhatsApp'], 'ru'), 'WhatsApp');
  assert.equal(joinNames(['WhatsApp', 'Instagram'], 'ru'), 'WhatsApp и Instagram');
  assert.equal(
    joinNames(['WhatsApp', 'Instagram', 'Telegram'], 'ru'),
    'WhatsApp, Instagram и Telegram',
  );
  assert.equal(joinNames(['WhatsApp', 'Instagram'], 'en'), 'WhatsApp and Instagram');
  assert.equal(joinNames([], 'ru'), '');
});

test('текст бота: «К WhatsApp и Instagram не подключается»', () => {
  const ru = customerBotOffer('ru', ['whatsapp', 'instagram']);
  assert.match(ru.solution, /К WhatsApp и Instagram не подключается/);
  assert.match(ru.problem, /Клиенты пишут в WhatsApp и Instagram/);
  const en = customerBotOffer('en', ['whatsapp', 'instagram', 'telegram']);
  assert.match(en.solution, /does not connect to WhatsApp, Instagram and Telegram/);
});
