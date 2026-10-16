import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import type { AuthTokenPayload, User } from '../types.js';

/** Ключ подписи берётся только из конфигурации: в production без секрета приложение не стартует. */
const JWT_SECRET = config.authJwtSecret;

function toBase64Url(str: string): string {
  return Buffer.from(str, 'utf8').toString('base64url');
}

function fromBase64Url(str: string): string {
  return Buffer.from(str, 'base64url').toString('utf8');
}

function sign(content: string, secret: string): string {
  return createHmac('sha256', secret).update(content).digest('base64url');
}

/**
 * Создаёт mock-JWT токен, полностью соответствующий docs/data-model.md.
 * Содержит sub, email, name, plan, iat, exp.
 */
export function createMockToken(
  user: User,
  expiresInSeconds = 7 * 24 * 3600,
): { token: string; expiresAt: string } {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + expiresInSeconds;
  const expiresAt = new Date(exp * 1000).toISOString();

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload: AuthTokenPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
    iat: now,
    exp,
    jti: randomBytes(12).toString('base64url'),
  };

  const headerB64 = toBase64Url(JSON.stringify(header));
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const signature = sign(`${headerB64}.${payloadB64}`, JWT_SECRET);

  return {
    token: `${headerB64}.${payloadB64}.${signature}`,
    expiresAt,
  };
}

/**
 * Проверяет подпись и срок действия mock-JWT токена.
 */
export function verifyMockToken(token: string): AuthTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [headerB64, payloadB64, signature] = parts;

    // Заголовок: принимаем только HS256 (алгоритм фиксирован на сервере, а не выбирается токеном).
    const header = JSON.parse(fromBase64Url(headerB64)) as { alg?: unknown; typ?: unknown };
    if (header.alg !== 'HS256') {
      return null;
    }

    // Подпись сравниваем за константное время; никаких «тестовых» подписей.
    const expected = Buffer.from(sign(`${headerB64}.${payloadB64}`, JWT_SECRET), 'utf8');
    const given = Buffer.from(signature, 'utf8');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return null;
    }

    const payloadJson = fromBase64Url(payloadB64);
    const payload = JSON.parse(payloadJson) as Partial<AuthTokenPayload>;

    if (!payload.sub || typeof payload.sub !== 'string') {
      return null;
    }
    if (!payload.exp || typeof payload.exp !== 'number') {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return null;
    }

    return payload as AuthTokenPayload;
  } catch {
    return null;
  }
}
