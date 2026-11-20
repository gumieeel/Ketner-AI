import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryCounterStore } from '../billing/cost-counters.js';
import { alertKey } from '../billing/tier-alerts.js';
import { decide, setTierEnforcedForTests } from '../billing/tier-usage.js';
import { mailer as defaultMailer, type MailMessage, type Mailer } from '../services/mailer.js';
import { ownerMailer } from './index.js';
import { tierAlertsFor, type OwnerTelegram } from './solutions.js';

const PERIOD_END = '2026-12-01T00:00:00.000Z';
const OWNER = { userId: 'u1', plan: 'free' as const, email: 'owner@example.com', isVip: false };

function mailer(kind: Mailer['kind'], fail = false) {
  const mails: MailMessage[] = [];
  const value: Mailer = {
    kind,
    async send(message) {
      if (fail || kind === 'none') throw new Error('Отправка писем не настроена');
      mails.push(message);
    },
  };
  return { value, mails };
}

function telegram(linked: boolean) {
  const sent: string[] = [];
  const value: OwnerTelegram = {
    canNotify: () => linked,
    async notifyOwner(_userId, text) {
      sent.push(text);
    },
  };
  return { value, sent };
}

test('предупреждение об объёме: письмо и Telegram владельцу, по разу на канал', async (t) => {
  setTierEnforcedForTests(true);
  t.after(() => setTierEnforcedForTests(null));
  const counters = new MemoryCounterStore();
  const mail = mailer('smtp');
  const tg = telegram(true);
  const alerts = tierAlertsFor(counters, () => OWNER, { mailer: mail.value, telegram: tg.value });
  assert.equal(await alerts.check('u1', decide('start', 800, PERIOD_END)), 'warning');
  assert.equal(await alerts.check('u1', decide('start', 801, PERIOD_END)), null);
  assert.equal(mail.mails.length, 1);
  assert.equal(mail.mails[0]!.to, 'owner@example.com');
  assert.match(mail.mails[0]!.subject, /использовано 80% обращений тарифа Start/);
  assert.equal(tg.sent.length, 1);
  assert.match(tg.sent[0]!, /^<b>Ketner: использовано 80% обращений тарифа Start<\/b>/);
  assert.match(tg.sent[0]!, /\/contacts\?topic=payment/);
});

test('почта не настроена (production без SMTP): отметка не ставится, Telegram уходит', async (t) => {
  setTierEnforcedForTests(true);
  t.after(() => setTierEnforcedForTests(null));
  const counters = new MemoryCounterStore();
  const tg = telegram(true);
  const at80 = decide('start', 800, PERIOD_END);
  const alerts = tierAlertsFor(counters, () => OWNER, {
    mailer: mailer('none').value,
    telegram: tg.value,
  });
  assert.equal(await alerts.check('u1', at80), 'warning');
  assert.equal(tg.sent.length, 1);
  // Письмо не отмечено отправленным: уйдёт, когда почту настроят.
  assert.equal(await counters.claim(alertKey('u1', at80, 'warning')), true);
});

test('сбой SMTP: письмо не потеряно — отметка снята; без Telegram и без адреса — ничего', async (t) => {
  setTierEnforcedForTests(true);
  t.after(() => setTierEnforcedForTests(null));
  const counters = new MemoryCounterStore();
  const at80 = decide('start', 800, PERIOD_END);
  const failing = tierAlertsFor(counters, () => OWNER, { mailer: mailer('smtp', true).value });
  assert.equal(await failing.check('u1', at80), null);
  assert.equal(await counters.claim(alertKey('u1', at80, 'warning')), true, 'отметка снята');
  await counters.release(alertKey('u1', at80, 'warning'));

  const noEmail = tierAlertsFor(
    counters,
    () => ({ ...OWNER, email: undefined }) as unknown as typeof OWNER,
    { mailer: mailer('smtp').value, telegram: telegram(false).value },
  );
  assert.equal(await noEmail.check('u1', at80), null);
  assert.equal(await counters.claim(alertKey('u1', at80, 'warning')), true, 'отметки нет');
});

test('письма владельцам без явной почты в зависимостях берут общую (как вход по коду)', () => {
  // server.ts почту не передаёт: раньше заявки и предупреждения об объёме в production не уходили.
  assert.equal(ownerMailer({}), defaultMailer);
  const own = mailer('smtp').value;
  assert.equal(ownerMailer({ mailer: own }), own);
});
