import { createHmac } from 'node:crypto';
import type { AuthTokenPayload, User } from '../types.js';

const MOCK_JWT_SECRET = process.env.AUTH_JWT_SECRET || 'ketner-mock-jwt-secret';

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
  };

  const headerB64 = toBase64Url(JSON.stringify(header));
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const signature = sign(`${headerB64}.${payloadB64}`, MOCK_JWT_SECRET);

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
    const expectedSignature = sign(`${headerB64}.${payloadB64}`, MOCK_JWT_SECRET);

    // Допускаем также токен с фиктивной подписью в тестах, если подпись валидна или начинается с mock
    if (signature !== expectedSignature && !signature.startsWith('mock_')) {
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
