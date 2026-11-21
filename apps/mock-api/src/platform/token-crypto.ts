/**
 * Шифрование токенов внешних сервисов (GitHub, Google), которые хранятся на сервере
 * (docs/STAGE_F_SHEETS.md, раздел 2.2). AES-256-GCM, случайный IV 12 байт, тег аутентичности.
 * Формат строки: `v1.<iv>.<tag>.<body>` (base64url) — его же проверяет база
 * (`google_connections_token_format`).
 *
 * Ключ выводится из BETTER_AUTH_SECRET и **назначения**: `sha256('ketner:<назначение>:' + secret)`.
 * Назначение разделяет ключи: токен GitHub не расшифровать ключом Google и наоборот. Для GitHub это
 * ровно прежний ключ `ketner:github-token:` — сохранённые подключения читаются без перешифровки.
 *
 * Смена BETTER_AUTH_SECRET делает сохранённые токены нечитаемыми: расшифровка возвращает undefined,
 * подключение нужно сделать заново.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export type TokenPurpose = 'github-token' | 'google-token';

/** Та же форма, что проверяет ограничение базы `google_connections_token_format`. */
export const SEALED_TOKEN_FORMAT = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function keyFor(secret: string, purpose: TokenPurpose): Buffer {
  return createHash('sha256').update(`ketner:${purpose}:${secret}`, 'utf8').digest();
}

export function sealToken(token: string, secret: string, purpose: TokenPurpose): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret, purpose), iv);
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${body.toString('base64url')}`;
}

/** Расшифровка; чужой ключ, другое назначение или испорченная строка — undefined. */
export function openToken(
  value: string,
  secret: string,
  purpose: TokenPurpose,
): string | undefined {
  const [version, iv, tag, body] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !body) return undefined;
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      keyFor(secret, purpose),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return undefined;
  }
}
