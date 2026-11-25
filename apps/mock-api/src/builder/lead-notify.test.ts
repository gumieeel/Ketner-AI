import assert from 'node:assert/strict';
import test from 'node:test';
import type { Mailer, MailMessage } from '../services/mailer.js';
import { newBotAutomations } from './automations.js';
import { leadNotifyOf, leadTelegramText, notifyLead } from './lead-notify.js';
import type { BotLead } from './types.js';

const LEAD: BotLead = {
  id: 'lead-1',
  solutionId: 'bot-1',
  ownerId: 'u1',
  conversationId: null,
  name: 'Анна <b>&</b>',
  contact: '+7 700 000 00 00',
  question: 'Букет <script>alert(1)</script>',
  status: 'new',
  createdAt: '2026-11-23T10:00:00.000Z',
  updatedAt: '2026-11-23T10:00:00.000Z',
};

function channels(options: {
  mail?: Mailer['kind'];
  mailError?: Error;
  linked?: boolean;
  telegram?: boolean;
}) {
  const mails: MailMessage[] = [];
  const telegrams: Array<{ userId: string; text: string }> = [];
  const logs: string[] = [];
  return {
    mails,
    telegrams,
    logs,
    value: {
      ...(options.mail
        ? {
            mailer: {
              kind: options.mail,
              async send(message: MailMessage) {
                if (options.mailError) throw options.mailError;
                mails.push(message);
              },
            },
          }
        : {}),
      ...(options.telegram === false
        ? {}
        : {
            telegram: {
              canNotify: () => options.linked ?? true,
              async notifyOwner(userId: string, text: string) {
                telegrams.push({ userId, text });
              },
            },
          }),
      siteUrl: () => 'https://ketner.org',
      log: (line: string) => logs.push(line),
    },
  };
}

const OWNER = { userId: 'u1', email: 'owner@example.com' };
const bot = (leadNotify?: { email: boolean; telegram: boolean }) => ({
  id: 'bot-1',
  name: 'Лиса',
  bot: {
    slug: 'lisa',
    greeting: '',
    quickReplies: [],
    dailyCapCredits: 1000,
    corrections: [],
    ...(leadNotify ? { leadNotify } : {}),
  },
});

test('по умолчанию: у новых ботов письмо и Telegram; у ботов до шага — только письмо', () => {
  assert.deepEqual(leadNotifyOf({ ...bot().bot, automations: newBotAutomations() }), {
    email: true,
    telegram: true,
  });
  assert.deepEqual(leadNotifyOf(bot().bot), { email: true, telegram: false });
  assert.deepEqual(leadNotifyOf(bot({ email: false, telegram: true }).bot), {
    email: false,
    telegram: true,
  });
});

test('оба канала: письмо и Telegram владельцу, строка в логе на канал без имени и контакта', async () => {
  const c = channels({ mail: 'smtp' });
  const result = await notifyLead(c.value, OWNER, bot({ email: true, telegram: true }), LEAD);
  assert.deepEqual(result, { email: 'sent', telegram: 'sent' });
  assert.equal(c.mails[0]!.to, 'owner@example.com');
  assert.equal(c.mails[0]!.subject, 'Новая заявка: Анна <b>&</b>');
  assert.match(c.mails[0]!.html, /&#60;script&#62;/, 'в HTML письма ввод посетителя экранирован');
  assert.equal(c.telegrams[0]!.userId, 'u1');
  assert.deepEqual(c.logs, [
    '[bot] уведомление о заявке lead-1 (бот bot-1): письмо — отправлено',
    '[bot] уведомление о заявке lead-1 (бот bot-1): Telegram — отправлено',
  ]);
  const logText = c.logs.join('\n');
  for (const secret of ['Анна', '+7 700', 'owner@example.com', 'Букет']) {
    assert.ok(!logText.includes(secret), secret);
  }
});

test('Telegram: текст для parse_mode HTML — ввод посетителя экранирован, ссылка на кабинет', () => {
  const text = leadTelegramText({ id: 'bot-1', name: 'Лиса <i>' }, LEAD, 'https://ketner.org');
  assert.equal(
    text,
    [
      '<b>Новая заявка от бота «Лиса &#60;i&#62;».</b>',
      '',
      'Имя: Анна &#60;b&#62;&#38;&#60;/b&#62;',
      'Контакт: +7 700 000 00 00',
      'Вопрос: Букет &#60;script&#62;alert(1)&#60;/script&#62;',
      '',
      'Все заявки и диалоги: https://ketner.org/solutions/bot-1',
    ].join('\n'),
  );
});

test('выключено в настройках бота — канал не трогается, в логе «выключено»', async () => {
  const c = channels({ mail: 'smtp' });
  const result = await notifyLead(c.value, OWNER, bot({ email: false, telegram: false }), LEAD);
  assert.deepEqual(result, { email: 'off', telegram: 'off' });
  assert.equal(c.mails.length + c.telegrams.length, 0);
  assert.ok(c.logs.every((line) => line.endsWith('выключено в настройках бота')));
});

test('бот до шага: письмо уходит, Telegram — нет, даже если привязан', async () => {
  const c = channels({ mail: 'smtp' });
  assert.deepEqual(await notifyLead(c.value, OWNER, bot(), LEAD), {
    email: 'sent',
    telegram: 'off',
  });
  assert.equal(c.telegrams.length, 0);
});

test('причины пропуска: почта не настроена, нет адреса, Telegram не привязан или не подключён', async () => {
  const noMail = channels({ mail: 'none', linked: false });
  assert.deepEqual(
    await notifyLead(noMail.value, OWNER, bot({ email: true, telegram: true }), LEAD),
    { email: 'mail_not_configured', telegram: 'telegram_not_linked' },
  );
  const noAddress = channels({ mail: 'smtp', telegram: false });
  assert.deepEqual(
    await notifyLead(noAddress.value, { userId: 'u1' }, bot({ email: true, telegram: true }), LEAD),
    { email: 'no_email', telegram: 'telegram_not_configured' },
  );
  assert.match(noAddress.logs[0]!, /у аккаунта нет адреса почты$/);
});

test('сбой SMTP не мешает Telegram; в логе код ошибки, а не текст с адресом', async () => {
  const failure = Object.assign(new Error('Recipient rejected: owner@example.com'), {
    code: 'EENVELOPE',
  });
  const c = channels({ mail: 'smtp', mailError: failure });
  const result = await notifyLead(c.value, OWNER, bot({ email: true, telegram: true }), LEAD);
  assert.deepEqual(result, { email: 'failed:EENVELOPE', telegram: 'sent' });
  assert.match(c.logs[0]!, /письмо — ошибка отправки \(EENVELOPE\)$/);
  assert.ok(!c.logs.join('\n').includes('owner@example.com'));
});
