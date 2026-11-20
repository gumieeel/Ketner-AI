import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alertFor,
  alertKey,
  alertMail,
  alertTelegramText,
  TierAlerts,
  type TierAlertChannel,
  type TierAlertKind,
} from './tier-alerts.js';
import { MemoryCounterStore } from './cost-counters.js';
import { decide, setTierEnforcedForTests } from './tier-usage.js';

const PERIOD_END = '2026-12-01T00:00:00.000Z';
const LINKS = {
  solutions: 'https://ketner.org/solutions',
  contacts: 'https://ketner.org/contacts',
};

test('какое письмо: 80% и льготный объём — предупреждение, 110% — режим заявок', () => {
  // Growth: 5 000 включённых, предупреждение с 4 000, льготные до 5 500.
  assert.equal(alertFor(decide('growth', 3_999, PERIOD_END)), null);
  assert.equal(alertFor(decide('growth', 4_000, PERIOD_END)), 'warning');
  assert.equal(alertFor(decide('growth', 5_200, PERIOD_END)), 'warning');
  assert.equal(alertFor(decide('growth', 5_500, PERIOD_END)), 'leads_only');
  // Без тарифа — не письмо об объёме (это «тариф не назначен», строка в кабинете).
  assert.equal(alertFor(decide(null, 10_000, PERIOD_END)), null);
});

test('ключ «отправлено»: аккаунт, месяц, вид письма', () => {
  const decision = decide('start', 900, PERIOD_END);
  assert.equal(alertKey('u1', decision, 'warning'), 'tier-alert:u1:2026-12-01:warning');
  assert.notEqual(
    alertKey('u1', decide('start', 900, '2027-01-01T00:00:00.000Z'), 'warning'),
    alertKey('u1', decision, 'warning'),
    'новый месяц — новое письмо',
  );
});

test('тексты писем: числа из решения и каталога, последний день месяца, что делать', () => {
  const warning = alertMail('warning', decide('growth', 4_012, PERIOD_END), LINKS);
  assert.equal(warning.subject, 'Ketner: использовано 80% обращений тарифа Growth');
  const text = warning.lines.join('\n');
  assert.match(text, /4\s012 раз из 5\s000/);
  assert.match(text, /до 5\s500 обращений/);
  assert.match(text, /до конца 30 ноября/);
  assert.match(text, /только с вашего согласия/);
  assert.match(text, /https:\/\/ketner\.org\/contacts/);

  const leads = alertMail('leads_only', decide('start', 1_100, PERIOD_END), LINKS);
  assert.equal(leads.subject, 'Ketner: бот принимает только заявки до конца 30 ноября');
  const body = leads.lines.join('\n');
  assert.match(body, /1\s100 обращений при 1\s000 включённых и 100 льготных/);
  assert.match(body, /С нового месяца ответы возобновятся сами/);
});

test('одно письмо каждого вида за период; без включённых тарифов — ни одного', async (t) => {
  const claimed = new Set<string>();
  const sent: TierAlertKind[] = [];
  const alerts = new TierAlerts({
    claim: async (key) => !claimed.has(key) && Boolean(claimed.add(key)),
    release: async (key) => {
      claimed.delete(key);
    },
    channels: [
      {
        name: 'email',
        available: () => true,
        send: async (_user, kind) => {
          sent.push(kind);
        },
      },
    ],
    log: () => {},
  });
  setTierEnforcedForTests(false);
  assert.equal(await alerts.check('u1', decide('start', 900, PERIOD_END)), null, 'выключены');
  assert.equal(sent.length, 0);

  setTierEnforcedForTests(true);
  t.after(() => setTierEnforcedForTests(null));
  assert.equal(await alerts.check('u1', decide('start', 800, PERIOD_END)), 'warning');
  assert.equal(await alerts.check('u1', decide('start', 950, PERIOD_END)), null);
  assert.equal(await alerts.check('u1', decide('start', 1_100, PERIOD_END)), 'leads_only');
  assert.equal(await alerts.check('u1', decide('start', 1_300, PERIOD_END)), null);
  assert.equal(
    await alerts.check('u2', decide('start', 800, PERIOD_END)),
    'warning',
    'другой аккаунт',
  );
  assert.equal(await alerts.check('u1', decide('start', 10, PERIOD_END)), null, 'ниже 80%');
  assert.deepEqual(sent, ['warning', 'leads_only', 'warning']);
});

/** Отметки в памяти (как в хранилище счётчиков) и журнал отправок по каналам. */
function harness(channels: (sent: string[]) => TierAlertChannel[]) {
  const store = new MemoryCounterStore();
  const sent: string[] = [];
  const logged: string[] = [];
  const alerts = new TierAlerts({
    claim: (key) => store.claim(key),
    release: (key) => store.release(key),
    channels: channels(sent),
    log: (line) => logged.push(line),
  });
  return { store, sent, logged, alerts };
}

test('сбой отправки: отметка снимается, следующая проверка отправляет; успех — больше не отправляет', async (t) => {
  setTierEnforcedForTests(true);
  t.after(() => setTierEnforcedForTests(null));
  let fail = true;
  const { store, sent, logged, alerts } = harness((sent) => [
    {
      name: 'email',
      available: () => true,
      send: async (_user, kind) => {
        if (fail) throw new Error('smtp down');
        sent.push(`email:${kind}`);
      },
    },
  ]);
  const at80 = decide('start', 800, PERIOD_END);
  assert.equal(await alerts.check('u1', at80), null, 'не отправлено');
  assert.match(logged.join('\n'), /alert failed user=u1 kind=warning channel=email: smtp down/);
  // Отметка снята: её можно поставить снова.
  assert.equal(await store.claim(alertKey('u1', at80, 'warning')), true);
  await store.release(alertKey('u1', at80, 'warning'));

  fail = false;
  assert.equal(await alerts.check('u1', decide('start', 801, PERIOD_END)), 'warning');
  assert.equal(await alerts.check('u1', decide('start', 802, PERIOD_END)), null, 'уже отправлено');
  assert.deepEqual(sent, ['email:warning']);
});

test('параллельные проверки: письмо уходит один раз, пока первое ещё отправляется', async (t) => {
  setTierEnforcedForTests(true);
  t.after(() => setTierEnforcedForTests(null));
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const { sent, alerts } = harness((sent) => [
    {
      name: 'email',
      available: () => true,
      send: async (_user, kind) => {
        await gate;
        sent.push(kind);
      },
    },
  ]);
  const first = alerts.check('u1', decide('start', 800, PERIOD_END));
  const second = alerts.check('u1', decide('start', 801, PERIOD_END));
  finish();
  assert.deepEqual(await Promise.all([first, second]), ['warning', null]);
  assert.deepEqual(sent, ['warning']);
});

test('Telegram: отдельная отметка; сбой Telegram не мешает письму и повторяется сам по себе', async (t) => {
  setTierEnforcedForTests(true);
  t.after(() => setTierEnforcedForTests(null));
  let telegramDown = true;
  let linked = true;
  const { sent, alerts } = harness((sent) => [
    {
      name: 'email',
      available: () => true,
      send: async (_user, kind) => {
        sent.push(`email:${kind}`);
      },
    },
    {
      name: 'telegram',
      available: () => linked,
      send: async (_user, kind) => {
        if (telegramDown) throw new Error('telegram 502');
        sent.push(`telegram:${kind}`);
      },
    },
  ]);
  assert.equal(await alerts.check('u1', decide('start', 800, PERIOD_END)), 'warning');
  assert.deepEqual(sent, ['email:warning'], 'письмо ушло, хотя Telegram упал');

  telegramDown = false;
  assert.equal(await alerts.check('u1', decide('start', 805, PERIOD_END)), 'warning');
  assert.deepEqual(sent, ['email:warning', 'telegram:warning'], 'письмо второй раз не ушло');

  // Не привязан — отметка не ставится: сообщение уйдёт после привязки в этом же периоде.
  linked = false;
  assert.equal(await alerts.check('u1', decide('start', 1_100, PERIOD_END)), 'leads_only');
  linked = true;
  assert.equal(await alerts.check('u1', decide('start', 1_101, PERIOD_END)), 'leads_only');
  assert.deepEqual(sent, [
    'email:warning',
    'telegram:warning',
    'email:leads_only',
    'telegram:leads_only',
  ]);
});

test('ключи каналов: у почты — прежний ключ, у Telegram — с суффиксом', () => {
  const decision = decide('start', 800, PERIOD_END);
  assert.equal(alertKey('u1', decision, 'warning'), 'tier-alert:u1:2026-12-01:warning');
  assert.equal(
    alertKey('u1', decision, 'warning', 'telegram'),
    'tier-alert:u1:2026-12-01:warning:telegram',
  );
});

test('текст для Telegram: тема жирным, строки письма экранированы', () => {
  const text = alertTelegramText({ subject: 'Ketner: 80% <Start>', lines: ['a & b', '', 'c'] });
  assert.equal(text, '<b>Ketner: 80% &lt;Start&gt;</b>\n\na &amp; b\n\nc');
  const mail = alertMail('warning', decide('start', 800, PERIOD_END), LINKS);
  assert.match(alertTelegramText(mail), /^<b>Ketner: использовано 80% обращений тарифа Start<\/b>/);
});
