import assert from 'node:assert/strict';
import test from 'node:test';
import { DocStore } from '../store/doc-store.js';
import { CreditStore } from '../store/credit-store.js';
import { CreditService } from './credits.js';
import { LowCreditsNotifier, type LowCreditsNotice } from './low-credits-notifier.js';
import type { MailMessage } from './mailer.js';

const NOW = Date.parse('2026-11-01T10:00:00.000Z');
const LATER = new Date(NOW + 30 * 86_400_000).toISOString();

function setup(options: { email?: string; remindersOff?: boolean; failMail?: boolean } = {}) {
  const store = new CreditStore();
  const credits = new CreditService(store);
  const notices = new DocStore<LowCreditsNotice>('low_credit_notices');
  const mails: MailMessage[] = [];
  let fail = options.failMail ?? false;
  const notifier = new LowCreditsNotifier({
    credits: store,
    notices,
    users: {
      findById: (id) =>
        id === 'u1'
          ? ({ id, email: options.email ?? 'owner@example.com', name: 'Анна' } as never)
          : null,
    },
    mailer: {
      kind: 'smtp',
      async send(message) {
        if (fail) throw new Error('smtp down');
        mails.push(message);
      },
    },
    remindersOff: () => options.remindersOff ?? false,
    siteUrl: 'https://ketner.org',
    now: () => NOW,
  });
  store.grant({ id: 'pack-1', userId: 'u1', kind: 'pack', amountUsd: 10, expiresAt: LATER }, NOW);
  return {
    store,
    credits,
    notices,
    mails,
    notifier,
    setFail: (value: boolean) => {
      fail = value;
    },
  };
}

test('письмо «кредиты на исходе»: один раз при 20%, снова — после нового начисления', async () => {
  const { store, mails, notifier } = setup();
  store.debit('u1', 7.9, NOW);
  assert.equal(await notifier.run('u1'), false, '21% — рано');
  store.debit('u1', 0.2, NOW);
  assert.equal(await notifier.run('u1'), true, '19% — письмо');
  assert.equal(mails.length, 1);
  assert.equal(mails[0]?.to, 'owner@example.com');
  assert.match(mails[0]?.subject ?? '', /Кредиты на исходе: осталось 1\s900/);
  assert.match(mails[0]?.text ?? '', /https:\/\/ketner\.org\/pricing/);
  assert.match(mails[0]?.text ?? '', /боты для клиентов перестанут отвечать сами/);

  store.debit('u1', 1, NOW);
  assert.equal(await notifier.run('u1'), false, 'повторно не пишем');
  assert.equal(mails.length, 1);

  // Новое начисление — новый набор грантов: при следующем снижении письмо снова уйдёт.
  store.grant({ id: 'pack-2', userId: 'u1', kind: 'pack', amountUsd: 10, expiresAt: LATER }, NOW);
  assert.equal(await notifier.run('u1'), false, 'после пополнения остаток выше 20%');
  store.debit('u1', 10, NOW);
  assert.equal(await notifier.run('u1'), true);
  assert.equal(mails.length, 2);
});

test('без почты, с выключенными напоминаниями — не пишем; сбой почты — повтор при следующем списании', async () => {
  const telegram = setup({ email: 'tg-1@telegram.invalid' });
  telegram.store.debit('u1', 9, NOW);
  assert.equal(await telegram.notifier.run('u1'), false);

  const off = setup({ remindersOff: true });
  off.store.debit('u1', 9, NOW);
  assert.equal(await off.notifier.run('u1'), false);

  const failing = setup({ failMail: true });
  failing.store.debit('u1', 9, NOW);
  await assert.rejects(failing.notifier.run('u1'));
  assert.equal(failing.notices.get('u1'), undefined, 'отметка снята — письмо попробуем снова');
  failing.setFail(false);
  assert.equal(await failing.notifier.run('u1'), true);
});

test('списание кредитов зовёт обработчик только при реальном списании', () => {
  const { credits } = setup();
  const seen: string[] = [];
  credits.onCharged = (userId) => seen.push(userId);
  assert.ok(credits.charge('u1', 1, NOW) > 0);
  assert.equal(credits.charge('u1', 0, NOW), 0);
  assert.deepEqual(seen, ['u1']);
  credits.onCharged = () => {
    throw new Error('boom');
  };
  assert.ok(credits.charge('u1', 1, NOW) > 0, 'сбой обработчика не мешает списанию');
});
