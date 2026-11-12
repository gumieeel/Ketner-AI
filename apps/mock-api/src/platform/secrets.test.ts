import assert from 'node:assert/strict';
import test from 'node:test';
import { SECRET_CORPUS } from './secret-corpus.js';
import {
  containsSecret,
  findSecrets,
  isSecretTripwire,
  sanitizeForJournal,
  TRIPWIRE_PLACEHOLDER,
  writeJournalSafely,
} from './secrets.js';

for (const item of SECRET_CORPUS) {
  test(`секреты: ${item.name} → ${item.secret ? 'секрет' : 'не секрет'}`, () => {
    assert.equal(containsSecret(item.doc), item.secret, JSON.stringify(findSecrets(item.doc)));
  });
}

test('секреты: очистка убирает всё найденное и не трогает остальное', () => {
  for (const item of SECRET_CORPUS) {
    const { value, redactions } = sanitizeForJournal(item.doc);
    assert.equal(containsSecret(value), false, item.name);
    assert.equal(redactions.length > 0, item.secret, item.name);
    if (!item.secret) assert.deepEqual(value, item.doc, item.name);
  }
  const { value } = sanitizeForJournal({
    step: 'send',
    size: 120,
    headers: { Authorization: 'Bearer abcdefgh12345678' },
  });
  assert.deepEqual(value, {
    step: 'send',
    size: 120,
    headers: { Authorization: '[redacted:authorization_header]' },
  });
});

test('секреты: запись журнала очищает метаданные до записи', async () => {
  const written: unknown[] = [];
  const result = await writeJournalSafely(
    { accessToken: 'ya29.a0AfH6SMBx', size: 3 },
    async (meta) => {
      written.push(meta);
    },
  );
  assert.deepEqual(written, [{ accessToken: '[redacted:secret_field]', size: 3 }]);
  assert.equal(result.tripwire, false);
  assert.equal(result.redactions.length, 1);
});

test('секреты: сработавшая проверка базы не теряет строку журнала — запись с заглушкой', async () => {
  const written: unknown[] = [];
  const reports: string[] = [];
  const result = await writeJournalSafely(
    { note: 'безобидно для кода' },
    async (meta) => {
      written.push(meta);
      if (written.length === 1) {
        throw Object.assign(new Error('check'), {
          code: '23514',
          constraint_name: 'execution_events_no_secrets',
        });
      }
    },
    (message) => reports.push(message),
  );
  assert.equal(result.tripwire, true);
  assert.deepEqual(written, [{ note: 'безобидно для кода' }, TRIPWIRE_PLACEHOLDER]);
  assert.equal(reports.length, 1);
});

test('секреты: другие ошибки базы не глотаются', async () => {
  const fk = Object.assign(new Error('fk'), {
    code: '23503',
    constraint_name: 'execution_events_execution_id_user_id_fkey',
  });
  assert.equal(isSecretTripwire(fk), false);
  await assert.rejects(
    writeJournalSafely({ a: 1 }, async () => {
      throw fk;
    }),
    /fk/,
  );
});
