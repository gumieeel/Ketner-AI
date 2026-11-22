import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CELL_LIMIT,
  LEAD_SHEET_COLUMNS,
  LEAD_SHEET_WIDTHS,
  formatLeadDate,
  isHandle,
  isPhoneNumber,
  leadRow,
  leadSheetHeaders,
  leadSpreadsheetBody,
  neutralizeFormula,
  validTimeZone,
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

test('дата заявки: в поясе владельца, если он известен; иначе UTC с пометкой', () => {
  // 06:35 UTC — 11:35 в Кызылорде (UTC+5), как у заявки владельца на проверке.
  assert.equal(formatLeadDate('2026-11-22T06:35:10.000Z', 'Asia/Qyzylorda'), '2026-11-22 11:35');
  assert.equal(formatLeadDate('2026-11-22T22:10:00.000Z', 'Asia/Almaty'), '2026-11-23 03:10');
  assert.equal(formatLeadDate('2026-11-22T06:35:10.000Z'), '2026-11-22 06:35 UTC');
  assert.equal(formatLeadDate('2026-11-22T06:35:10.000Z', 'Not/AZone'), '2026-11-22 06:35 UTC');
  assert.equal(validTimeZone('Asia/Qyzylorda'), 'Asia/Qyzylorda');
  assert.equal(validTimeZone('Europe/Moscow; drop'), null);
  assert.equal(validTimeZone(42), null);
  const row = leadRow({
    createdAt: '2026-11-22T06:35:10.000Z',
    botName: 'Бот',
    name: 'Анна',
    contact: 'anna@example.com',
    question: 'Вопрос',
    dialogUrl: 'https://ketner.org/solutions/s1',
    leadId: 'lead-1',
    timeZone: 'Asia/Qyzylorda',
  });
  assert.equal(row[0], '2026-11-22 11:35');
});

test('новая таблица: заголовок жирным, первая строка закреплена, ширина колонок, пояс владельца', () => {
  type Body = {
    properties: { title: string; timeZone?: string };
    sheets: Array<{
      properties: { gridProperties: { frozenRowCount: number } };
      data: Array<{
        rowData: Array<{
          values: Array<{
            userEnteredValue: { stringValue: string };
            userEnteredFormat: { textFormat: { bold: boolean } };
          }>;
        }>;
        columnMetadata: Array<{ pixelSize: number }>;
      }>;
    }>;
  };
  const known = leadSpreadsheetBody('Asia/Qyzylorda') as Body;
  assert.equal(known.properties.timeZone, 'Asia/Qyzylorda');
  assert.equal(known.sheets[0]!.properties.gridProperties.frozenRowCount, 1);
  const header = known.sheets[0]!.data[0]!.rowData[0]!.values;
  assert.deepEqual(
    header.map((cell) => cell.userEnteredValue.stringValue),
    ['Дата', ...LEAD_SHEET_COLUMNS.slice(1)],
  );
  assert.ok(header.every((cell) => cell.userEnteredFormat.textFormat.bold));
  assert.deepEqual(
    known.sheets[0]!.data[0]!.columnMetadata.map((column) => column.pixelSize),
    [...LEAD_SHEET_WIDTHS],
  );
  assert.equal(LEAD_SHEET_WIDTHS.length, LEAD_SHEET_COLUMNS.length);

  const unknown = leadSpreadsheetBody(null) as Body;
  assert.equal(unknown.properties.timeZone, undefined);
  assert.equal(
    unknown.sheets[0]!.data[0]!.rowData[0]!.values[0]!.userEnteredValue.stringValue,
    'Дата (UTC)',
  );
  assert.deepEqual(leadSheetHeaders('Asia/Qyzylorda')[0], 'Дата');
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
