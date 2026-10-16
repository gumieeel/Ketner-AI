import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config, isProduction } from '../config.js';

/** Происхождение (scheme://host[:port]) адреса или null. */
function originOf(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * Сайты, которым браузер разрешит читать ответы API с cookie пользователя (CORS с credentials).
 * Только свои адреса: раньше функция в конце пропускала любой Origin, и любой сайт мог от имени
 * вошедшего человека читать его диалоги и менять подписку.
 */
export function allowedCorsOrigins(): Set<string> {
  const origins = new Set<string>(['https://ketner.org', 'https://www.ketner.org']);
  for (const raw of [
    config.corsOrigin,
    config.webAppUrl,
    config.betterAuthUrl,
    process.env.RENDER_EXTERNAL_URL,
  ]) {
    const origin = originOf(raw);
    if (origin) origins.add(origin);
  }
  for (const raw of (process.env.CORS_EXTRA_ORIGINS ?? '').split(',')) {
    const origin = originOf(raw.trim());
    if (origin) origins.add(origin);
  }
  return origins;
}

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function isAllowedCorsOrigin(origin: string, production = isProduction): boolean {
  if (allowedCorsOrigins().has(origin)) return true;
  return !production && LOCAL_ORIGIN.test(origin);
}

/**
 * Эндпоинты Better Auth, доступные из браузера. Остальные (регистрация в обход сайта, смена почты
 * и пароля, удаление и привязка аккаунтов, сброс пароля) закрыты: сайт вызывает нужное сам на сервере.
 * Регистрация напрямую в Better Auth позволяла завести запись с чужой почтой и войти в чужой аккаунт.
 */
const BETTER_AUTH_PUBLIC: ReadonlyArray<{ methods: readonly string[]; pattern: RegExp }> = [
  { methods: ['GET'], pattern: /^\/api\/auth\/get-session$/ },
  { methods: ['POST'], pattern: /^\/api\/auth\/sign-out$/ },
  { methods: ['POST'], pattern: /^\/api\/auth\/sign-in\/(email|social)$/ },
  { methods: ['GET', 'POST'], pattern: /^\/api\/auth\/callback\/[a-z0-9_-]+(\/oauth-proxy)?$/ },
  { methods: ['GET'], pattern: /^\/api\/auth\/oauth-proxy-callback$/ },
  { methods: ['GET'], pattern: /^\/api\/auth\/(error|ok)$/ },
  { methods: ['GET'], pattern: /^\/api\/auth\/list-sessions$/ },
  { methods: ['POST'], pattern: /^\/api\/auth\/revoke-(session|sessions|other-sessions)$/ },
  // Панель Better Auth (плагин dash): запросы подписаны ключом BETTER_AUTH_API_KEY, проверяет плагин.
  { methods: ['GET', 'POST'], pattern: /^\/api\/auth\/dash\// },
];

export function isPublicBetterAuthEndpoint(method: string, path: string): boolean {
  const verb = method === 'HEAD' ? 'GET' : method;
  return BETTER_AUTH_PUBLIC.some((rule) => rule.methods.includes(verb) && rule.pattern.test(path));
}

/** sha256-хеши встроенных <script> в index.html: CSP разрешает ровно их, а не любые inline-скрипты. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    if (match[1].trim() === '') continue;
    hashes.push(`'sha256-${createHash('sha256').update(match[1], 'utf8').digest('base64')}'`);
  }
  return hashes;
}

/** Источники тега Google (gtag.js) для Google Ads — по рекомендациям Google для CSP. */
const GOOGLE_TAG_SCRIPTS = [
  'https://www.googletagmanager.com',
  'https://www.googleadservices.com',
  'https://www.google.com',
  'https://googleads.g.doubleclick.net',
];
const GOOGLE_TAG_CONNECT = [
  'https://www.googletagmanager.com',
  'https://www.googleadservices.com',
  'https://www.google.com',
  'https://googleads.g.doubleclick.net',
  'https://*.google-analytics.com',
  'https://*.analytics.google.com',
  'https://*.doubleclick.net',
];
const GOOGLE_TAG_FRAMES = [
  'https://www.googletagmanager.com',
  'https://td.doubleclick.net',
  'https://bid.g.doubleclick.net',
];

/**
 * Content-Security-Policy для веб-интерфейса. Главное — script-src: даже если в разметку попадёт
 * чужой код (XSS), браузер не выполнит ни inline-скрипт, ни скрипт с постороннего домена, и токен
 * из localStorage не утечёт. Мини-приложение Telegram открывается во фрейме web.telegram.org.
 */
export function buildContentSecurityPolicy(indexHtml: string | null): string {
  const connect = new Set<string>(["'self'"]);
  for (const origin of allowedCorsOrigins()) connect.add(origin);
  const apiOrigin = originOf(process.env.VITE_API_URL);
  if (apiOrigin) connect.add(apiOrigin);
  if (!isProduction) {
    connect.add('http://localhost:*');
    connect.add('ws://localhost:*');
  }
  const scriptHashes = indexHtml ? inlineScriptHashes(indexHtml) : [];
  // Тег Google Ads (gtag.js): загрузка скрипта, отправка конверсий и служебные фреймы.
  for (const origin of GOOGLE_TAG_CONNECT) connect.add(origin);
  return [
    "default-src 'self'",
    `script-src 'self' https://telegram.org ${GOOGLE_TAG_SCRIPTS.join(' ')} ${scriptHashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    `connect-src ${[...connect].join(' ')}`,
    `frame-src 'self' ${GOOGLE_TAG_FRAMES.join(' ')}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com https://github.com",
    "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
  ].join('; ');
}

/** Заголовки безопасности для всех ответов; CSP — только для HTML-страниц. */
export function securityHeaders(getCsp: () => string) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (isProduction) {
      response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(self), geolocation=(), payment=(), usb=()',
    );
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    // Ответы API в чужие фреймы не встраиваются; страницы сайта — см. frame-ancestors в CSP.
    if (request.path.startsWith('/api/') || request.path.startsWith('/v1/')) {
      response.setHeader('X-Frame-Options', 'DENY');
      response.setHeader('Cache-Control', response.getHeader('Cache-Control') ?? 'no-store');
    } else {
      response.setHeader('Content-Security-Policy', getCsp());
    }
    next();
  };
}
