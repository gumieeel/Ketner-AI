import assert from 'node:assert/strict';
import test from 'node:test';
import { createGooglePrefsStore } from './prefs.js';
import { DocStore } from '../store/doc-store.js';
import type { GooglePrefsDoc } from './prefs.js';

function store() {
  return createGooglePrefsStore(new DocStore<GooglePrefsDoc>('google_prefs_test'));
}

test('пояс и прежняя таблица живут в одной записи и не затирают друг друга', async () => {
  const prefs = store();
  prefs.rememberTimeZone('u1', 'Asia/Qyzylorda');
  await prefs.setLostSheet('u1', { id: 'sheet-old-0123456789', url: null });
  assert.equal(prefs.timeZoneOf('u1'), 'Asia/Qyzylorda');
  assert.deepEqual(
    { ...prefs.lostSheetOf('u1'), at: undefined },
    {
      id: 'sheet-old-0123456789',
      url: 'https://docs.google.com/spreadsheets/d/sheet-old-0123456789/edit',
      at: undefined,
    },
  );

  prefs.rememberTimeZone('u1', 'Asia/Almaty');
  assert.equal(
    prefs.lostSheetOf('u1')?.id,
    'sheet-old-0123456789',
    'смена пояса не теряет таблицу',
  );

  await prefs.setLostSheet('u1', null);
  assert.equal(prefs.lostSheetOf('u1'), null);
  assert.equal(prefs.timeZoneOf('u1'), 'Asia/Almaty', 'забыть таблицу — не забыть пояс');
});

test('прежняя таблица: только верный id и адрес docs.google.com', async () => {
  const prefs = store();
  await prefs.setLostSheet('u1', { id: '../../etc', url: 'https://docs.google.com/x' });
  assert.equal(prefs.lostSheetOf('u1'), null);
  await prefs.setLostSheet('u1', { id: 'sheet-old-0123456789', url: 'https://evil.example/x' });
  assert.equal(
    prefs.lostSheetOf('u1')?.url,
    'https://docs.google.com/spreadsheets/d/sheet-old-0123456789/edit',
  );
  assert.equal(await prefs.remove('u1'), true);
  assert.equal(prefs.lostSheetOf('u1'), null);
});
