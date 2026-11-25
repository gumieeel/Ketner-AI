import assert from 'node:assert/strict';
import test from 'node:test';
import { CAPABILITIES, catalogForPrompt } from './capabilities.js';
import { assessFeasibility } from './feasibility.js';
import { registryAvailability } from '../platform/compatibility.js';

/**
 * Google Таблицы в каталоге анализа (решение владельца 23.11.2026): заявки бота строками в таблицу —
 * есть (этап F), синхронизации произвольных таблиц — нет. Возможность «частично», анализ не
 * называет запись заявок в таблицу недоступной.
 */

const USER = { hasPurchasedCredits: false, githubConnected: false };

test('spreadsheets_sync — «частично»: заявки в таблицу есть, синхронизации произвольных таблиц нет', () => {
  assert.equal(CAPABILITIES.spreadsheets_sync.availability, 'partial');
  assert.equal(registryAvailability('spreadsheets_sync'), 'partial');
  assert.match(CAPABILITIES.spreadsheets_sync.label.ru, /заявки бота строками в вашу таблицу/);
  assert.match(CAPABILITIES.spreadsheets_sync.label.ru, /синхронизации произвольных таблиц нет/);
  assert.match(CAPABILITIES.spreadsheets_sync.hint.ru, /раздел «Заявки»/);
});

test('анализ: «заявка → таблица» — нужна интеграция, а не «не поддерживается»', () => {
  for (const language of ['ru', 'en'] as const) {
    const result = assessFeasibility(['text_generation', 'spreadsheets_sync'], USER, language);
    assert.equal(result.status, 'needs_integration', language);
    const sheets = result.blockers.find((item) => item.capability === 'spreadsheets_sync')!;
    assert.equal(sheets.status, 'needs_integration');
    assert.notEqual(sheets.status, 'not_supported');
    assert.doesNotMatch(sheets.hint, /Пока нет|Not yet/);
  }
});

test('каталог для модели: пометка «частично» и что именно есть', () => {
  const ru = catalogForPrompt('ru')
    .split('\n')
    .find((line) => line.startsWith('- spreadsheets_sync:'))!;
  assert.match(ru, /заявки бота строками в вашу таблицу/);
  assert.match(ru, /\(частично, после подключения: только то, что в описании\)$/);
  assert.doesNotMatch(ru, /\(нет\)$/);
  const en = catalogForPrompt('en')
    .split('\n')
    .find((line) => line.startsWith('- spreadsheets_sync:'))!;
  assert.match(en, /\(partly, after connecting: only what is described\)$/);
});
