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
    response.redirect(301, `${base}${request.originalUrl}`);
  };
}
