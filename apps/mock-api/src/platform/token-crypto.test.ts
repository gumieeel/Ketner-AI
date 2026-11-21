import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { decryptToken, encryptToken } from '../github/connection-store.js';
import { openToken, SEALED_TOKEN_FORMAT, sealToken } from './token-crypto.js';

// Зашифровано кодом GitHub-подключений до выноса в token-crypto.ts (encryptToken на main 21.11.2026):
// токен 'gho_fixtureToken123', секрет 'fixture-secret-for-format-check'. Формат и ключ не изменились.
const BEFORE_EXTRACTION = 'v1.KrDcHkfbiF1OPrsZ.x0DFTEiv1f5WEgfdH4-OZQ.GcEi4SJelOVVP8-FPpl8-qu56g';
const SECRET = 'fixture-secret-for-format-check';

test('GitHub: токен, зашифрованный до выноса, читается — и новым кодом, и прежней функцией', () => {
  assert.equal(openToken(BEFORE_EXTRACTION, SECRET, 'github-token'), 'gho_fixtureToken123');
  assert.equal(decryptToken(BEFORE_EXTRACTION, SECRET), 'gho_fixtureToken123');
  // И обратно: новый шифротекст GitHub читает прежняя функция.
  assert.equal(decryptToken(sealToken('gho_new', SECRET, 'github-token'), SECRET), 'gho_new');
  assert.equal(openToken(encryptToken('gho_old', SECRET), SECRET, 'github-token'), 'gho_old');
});

test('назначение разделяет ключи: токен GitHub не расшифровать как Google и наоборот', () => {
  assert.equal(openToken(BEFORE_EXTRACTION, SECRET, 'google-token'), undefined);
  const google = sealToken('1//google-refresh', SECRET, 'google-token');
  assert.equal(openToken(google, SECRET, 'google-token'), '1//google-refresh');
  assert.equal(openToken(google, SECRET, 'github-token'), undefined);
  assert.equal(decryptToken(google, SECRET), undefined);
});

test('другой секрет, испорченный шифротекст или формат — undefined', () => {
  const sealed = sealToken('1//google-refresh', SECRET, 'google-token');
  assert.equal(openToken(sealed, 'rotated-secret', 'google-token'), undefined);
  const parts = sealed.split('.');
  const body = Buffer.from(parts[3]!, 'base64url');
  body[0] = body[0]! ^ 0xff;
  const tampered = [...parts.slice(0, 3), body.toString('base64url')].join('.');
  assert.equal(openToken(tampered, SECRET, 'google-token'), undefined);
  assert.equal(openToken('v2.a.b.c', SECRET, 'google-token'), undefined);
  assert.equal(openToken('1//plain-token', SECRET, 'google-token'), undefined);
});

test('формат совпадает с проверкой базы; одинаковый токен шифруется по-разному (случайный IV)', () => {
  const first = sealToken('1//same', SECRET, 'google-token');
  const second = sealToken('1//same', SECRET, 'google-token');
  assert.match(first, SEALED_TOKEN_FORMAT);
  assert.match(BEFORE_EXTRACTION, SEALED_TOKEN_FORMAT);
  assert.notEqual(first, second);
  assert.ok(!first.includes('same'));
});

test('форма шифротекста в коде — та же, что в ограничении базы google_connections_token_format', () => {
  const sql = readFileSync(
    new URL('../../../../docs/stage-f/0016_google_sheets.proposal.sql', import.meta.url),
    'utf8',
  );
  const match = /refresh_token_enc ~ '([^']+)'/.exec(sql);
  assert.ok(match, 'ограничение формы есть в SQL');
  assert.equal(match[1], SEALED_TOKEN_FORMAT.source);
});
