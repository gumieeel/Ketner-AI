import assert from 'node:assert/strict';
import test from 'node:test';
import { alertFor, alertKey, alertMail, TierAlerts, type TierAlertKind } from './tier-alerts.js';
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
    send: async (_user, kind) => {
      sent.push(kind);
    },
    log: () => {},
  });
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
