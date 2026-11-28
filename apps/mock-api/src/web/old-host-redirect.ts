/**
 * Старый адрес сайта ketner-ai.onrender.com → https://ketner.org (тот же путь и запрос), 301.
 * Владелец открыл отчёт на старом адресе (28.11.2026): у людей остались закладки и старые ссылки.
 *
 * Перенаправляются только GET и HEAD страниц. Не перенаправляются — и почему:
 * - `/api/*` — API сайта, а вместе с ним вебхуки Telegram (`/api/telegram/...`), платежей
 *   (`/api/webhooks/...`), колбэки OAuth (`/api/auth/callback/...`, `/api/integrations/google/...`)
 *   и проверка Render (`/api/health`): у внешних отправителей и провайдеров записан этот адрес,
 *   POST после 301 превращается в GET, а колбэк OAuth должен вернуться на тот адрес, с которого
 *   начался вход;
 * - `/v1`, `/v1/*` — API для разработчиков: клиенты с ключом не ходят по переадресациям;
 * - `/widget.js` — виджет, вставленный на чужие сайты по старому адресу; он сам обращается к API
 *   по адресу, откуда загружен;
 * - `/assets/*` — файлы сборки: модульные скрипты с другого адреса требуют CORS, а открытые
 *   вкладки старой версии должны догрузиться.
 * Всё остальное (POST, PUT, DELETE и т. д.) не перенаправляется.
 *
 * Защита от петли: адрес сайта (`siteUrl()`) берётся из SITE_URL или WEB_APP_URL, по умолчанию
 * https://ketner.org. Если его когда-нибудь настроят на старый хост, переадресация выключается.
 */

import type { NextFunction, Request, Response } from 'express';

export const OLD_HOSTS: readonly string[] = ['ketner-ai.onrender.com'];

const EXCLUDED: readonly RegExp[] = [
  /^\/api(\/|$)/,
  /^\/v1(\/|$)/,
  /^\/widget\.js$/,
  /^\/assets\//,
];

export function oldHostRedirect(target: () => string) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return next();
    const host = String(request.headers.host ?? '')
      .split(':')[0]!
      .toLowerCase();
    if (!OLD_HOSTS.includes(host)) return next();
    if (EXCLUDED.some((pattern) => pattern.test(request.path))) return next();
    const base = target().replace(/\/+$/, '');
    // Защита от петли: если адрес сайта по ошибке настроен на старый хост (SITE_URL или
    // WEB_APP_URL на Render) или не разбирается, переадресации нет — страница отдаётся как есть.
    let targetHost: string;
    try {
      targetHost = new URL(base).hostname.toLowerCase();
    } catch {
      return next();
    }
    if (targetHost === host || OLD_HOSTS.includes(targetHost)) return next();
    response.redirect(301, `${base}${request.originalUrl}`);
  };
}
