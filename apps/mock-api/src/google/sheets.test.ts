import assert from 'node:assert/strict';
import test from 'node:test';
import { CELL_LIMIT, LEAD_SHEET_COLUMNS, leadRow, neutralizeFormula } from './sheets.js';

test('значения посетителя, похожие на формулу, получают апостроф: = + - @ табуляция, возврат каретки', () => {
  for (const value of [
    '=HYPERLINK("https://evil.example","нажми")',
    '+cmd|" /C calc"!A0',
    '-2+3+cmd|" /C calc"!A0',
    '@SUM(1+1)*cmd|" /C calc"!A0',
    '\t=1+1',
    '\r=1+1',
  ]) {
    assert.equal(neutralizeFormula(value), `'${value}`, JSON.stringify(value));
  }
  // Обычные значения — без изменений (в том числе пробел или знак не в начале).
  for (const value of ['Анна', 'anna@example.com', 'Цена 1+1?', ' =1+1', '8 900 000-00-00', '']) {
    assert.equal(neutralizeFormula(value), value, JSON.stringify(value));
  }
  // Обратная сторона правила: телефон с «+» и ник Telegram с «@» тоже получают апостроф и так
  // видны в таблице ('+7 900 …, '@anna_tg).
  assert.equal(neutralizeFormula('+7 900 000-00-00'), "'+7 900 000-00-00");
  assert.equal(neutralizeFormula('@anna_tg'), "'@anna_tg");
});

test('строка таблицы: обезврежены только поля посетителя; RAW-порядок колонок, ID заявки последней', () => {
  const row = leadRow({
    createdAt: '2026-11-21T11:59:30.000Z',
    botName: '=Бот владельца',
    name: '=1+1',
    contact: '-1',
    question: '@x',
    dialogUrl: 'https://ketner.org/solutions/s1',
    leadId: 'lead-1',
  });
  assert.equal(row.length, LEAD_SHEET_COLUMNS.length);
  assert.deepEqual(row, [
    '2026-11-21 11:59 UTC',
    '=Бот владельца',
    "'=1+1",
    "'-1",
    "'@x",
    'https://ketner.org/solutions/s1',
    'lead-1',
  ]);
});

test('апостроф учитывается в пределе ячейки', () => {
  const row = leadRow({
    createdAt: '2026-11-21T11:59:30.000Z',
    botName: 'Бот',
    name: 'Анна',
    contact: '+7',
    question: `=${'я'.repeat(60_000)}`,
    dialogUrl: 'https://ketner.org/solutions/s1',
    leadId: 'lead-1',
  });
  assert.equal(row[4]!.length, CELL_LIMIT);
  assert.ok(row[4]!.startsWith("'="));
  assert.ok(row[4]!.endsWith('…'));
});
