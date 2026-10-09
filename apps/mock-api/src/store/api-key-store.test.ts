import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ApiKeyLimitError,
  ApiKeyNameError,
  MAX_ACTIVE_API_KEYS_PER_USER,
  createApiKeyStore,
  looksLikeApiKey,
} from './api-key-store.js';

const tempFile = (): string => join(mkdtempSync(join(tmpdir(), 'ketner-keys-')), 'keys.json');

test('секрет имеет формат ketner_sk_ + 64 hex и показывается только при создании', () => {
  const store = createApiKeyStore(tempFile());
  const { key, secret } = store.create('u1', ' MacBook ');
  assert.ok(looksLikeApiKey(secret));
  assert.equal(key.name, 'MacBook');
  assert.equal(key.prefix, secret.slice(0, 14));
  assert.equal(JSON.stringify(store.list('u1')).includes(secret), false);
});

test('на диске лежит только SHA-256, секрета нет', () => {
  const file = tempFile();
  const store = createApiKeyStore(file);
  const { secret } = store.create('u1', 'ключ');
  const raw = readFileSync(file, 'utf8');
  assert.equal(raw.includes(secret), false);
  assert.match(raw, /"hash": "[0-9a-f]{64}"/);
});

test('verify находит действующий ключ и не пускает неизвестный, битый и отозванный', () => {
  const store = createApiKeyStore(tempFile());
  const { key, secret } = store.create('u1', 'ключ');
  assert.equal(store.verify(secret)?.userId, 'u1');
  assert.equal(store.verify(`ketner_sk_${'0'.repeat(64)}`), undefined);
  assert.equal(store.verify('ketner_sk_short'), undefined);
  assert.equal(store.verify('sk-other'), undefined);

  assert.equal(store.revoke('u1', key.id), true);
  assert.equal(store.verify(secret), undefined);
  assert.equal(store.revoke('u1', key.id), false, 'повторный отзыв ничего не делает');
});

test('чужой ключ отозвать нельзя, список только свой', () => {
  const store = createApiKeyStore(tempFile());
  const a = store.create('u1', 'a');
  store.create('u2', 'b');
  assert.equal(store.revoke('u2', a.key.id), false);
  assert.equal(store.list('u1').length, 1);
  assert.equal(store.list('u2').length, 1);
});

test('не больше 10 действующих ключей; отозванный освобождает место', () => {
  const store = createApiKeyStore(tempFile());
  const first = store.create('u1', 'k0');
  for (let i = 1; i < MAX_ACTIVE_API_KEYS_PER_USER; i++) store.create('u1', `k${i}`);
  assert.throws(() => store.create('u1', 'лишний'), ApiKeyLimitError);
  store.revoke('u1', first.key.id);
  assert.doesNotThrow(() => store.create('u1', 'лишний'));
});

test('имя ключа: от 1 до 60 символов', () => {
  const store = createApiKeyStore(tempFile());
  assert.throws(() => store.create('u1', '   '), ApiKeyNameError);
  assert.throws(() => store.create('u1', 'x'.repeat(61)), ApiKeyNameError);
  assert.doesNotThrow(() => store.create('u1', 'x'.repeat(60)));
});

test('ключи переживают перезапуск; touch обновляет время использования', () => {
  const file = tempFile();
  const first = createApiKeyStore(file);
  const { key, secret } = first.create('u1', 'ключ');
  first.touch(key.id);

  const second = createApiKeyStore(file);
  const record = second.verify(secret);
  assert.equal(record?.id, key.id);
  assert.ok(second.list('u1')[0].lastUsedAt, 'первое использование сохраняется сразу');
});
