import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CELL_LIMIT,
  LEAD_SHEET_COLUMNS,
  isHandle,
  isPhoneNumber,
  leadRow,
  neutralizeFormula,
} from './sheets.js';

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

test('телефон целиком и ник целиком — без апострофа; похожее на них с формулой — с апострофом', () => {
  // Только телефон: необязательный «+», цифры, пробелы, скобки, точки, дефисы; не меньше 5 цифр.
  for (const phone of [
    '+7 (701) 123-45-67',
    '+7 900 000-00-00',
    '+77011234567',
    '8 (701) 123.45.67',
    '-12345',
    '+1 (555) 010-9999',
  ]) {
    assert.equal(isPhoneNumber(phone), true, phone);
    assert.equal(neutralizeFormula(phone), phone, phone);
  }
  // Только ник: «@» и 3–32 латинские буквы, цифры, «_» или «.».
  for (const handle of ['@ivan_23', '@anna.tg', '@abc', `@${'a'.repeat(32)}`]) {
    assert.equal(isHandle(handle), true, handle);
    assert.equal(neutralizeFormula(handle), handle, handle);
  }
  // Всё остальное, что начинается с = + - @ табуляции или CR, — с апострофом.
  for (const risky of [
    '+SUM(1)',
    '@SUM(1)',
    '-1+1',
    '+1234',
    '+7 900 *2',
    '@ab',
    `@${'a'.repeat(33)}`,
    '@ivan 23',
    '@иван',
    '+7 (701) 123-45-67 =1+1',
    '=7 (701) 123-45-67',
    '\t+77011234567',
    '\r@ivan_23',
  ]) {
    assert.equal(neutralizeFormula(risky), `'${risky}`, JSON.stringify(risky));
  }
});
