import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

/**
 * Проверка initData мини-приложения по правилам Telegram: подпись HMAC-SHA256 с ключом
 * HMAC("WebAppData", токен бота) и свежесть auth_date. Подделать данные без токена бота нельзя.
 */
export function validateInitData(
  initData: string,
  botToken: string,
  options: { maxAgeSeconds?: number; now?: number } = {},
): { user: TelegramWebAppUser; authDate: number } | null {
  if (!initData || !botToken || initData.length > 4096) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const authDate = Number(params.get('auth_date'));
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  if (
    !Number.isFinite(authDate) ||
    now - authDate > (options.maxAgeSeconds ?? 24 * 3600) ||
    authDate - now > 300
  ) {
    return null;
  }
  try {
    const user = JSON.parse(params.get('user') ?? '') as TelegramWebAppUser;
    if (typeof user?.id !== 'number' || typeof user.first_name !== 'string') return null;
    return { user, authDate };
  } catch {
    return null;
  }
}

/** Подписывает initData — для тестов и локальной проверки. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}
