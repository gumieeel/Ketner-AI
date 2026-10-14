import type { Request } from 'express';
import { isProduction } from '../config.js';

/**
 * Гостевой идентификатор приходит только из заголовка X-Guest-Id и обязан иметь вид `guest_…`.
 * Идентификаторы аккаунтов в такой формат не попадают, поэтому гость не может назваться
 * зарегистрированным пользователем (заголовок X-User-Id игнорируется).
 */
const GUEST_ID_PATTERN = /^guest_[a-z0-9_]{8,64}$/;

export function readGuestId(request: Request): string | null {
  const header = request.headers['x-guest-id'];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' && GUEST_ID_PATTERN.test(value.trim()) ? value.trim() : null;
}

/**
 * Идентификатор анонимного пользователя. В production без корректного гостевого id вернётся null
 * (общий demo-user там не существует); вне production — запасной defaultUserId для тестов и разработки.
 */
export function resolveGuestId(request: Request, defaultUserId: string, production: boolean = isProduction): string | null {
  return readGuestId(request) ?? (production ? null : defaultUserId);
}
