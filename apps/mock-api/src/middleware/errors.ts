import type { NextFunction, Request, Response } from 'express';
import { isProduction } from '../config.js';

/** Единый формат ошибок API: фронтенд разбирает его в одном месте. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

/**
 * Единая точка ответа с ошибкой.
 *
 * Без неё формат ответа неизбежно разъедется между роутерами, а на фронтенде
 * его разбирает `ApiError` (apps/web/src/features/chat/api.ts).
 */
export function sendError(
  response: Response<ApiErrorBody>,
  status: number,
  code: string,
  message: string,
): void {
  response.status(status).json({ error: { code, message } });
}

export function notFoundHandler(request: Request, response: Response<ApiErrorBody>): void {
  sendError(
    response,
    404,
    'not_found',
    `Эндпоинт ${request.method} ${request.originalUrl} не найден`,
  );
}

export function errorHandler(
  error: unknown,
  _request: Request,
  response: Response<ApiErrorBody>,
  _next: NextFunction,
): void {
  // Ошибки разбора тела (битый JSON, слишком большой запрос) — это 4xx, а не сбой сервера.
  const status =
    (error as { status?: unknown; statusCode?: unknown } | null)?.status ??
    (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    sendError(
      response,
      status,
      status === 413 ? 'payload_too_large' : 'invalid_request',
      status === 413 ? 'Запрос слишком большой' : 'Некорректный запрос',
    );
    return;
  }
  console.error('[mock-api] необработанная ошибка:', error);
  if (response.headersSent) return;
  // Текст внутренней ошибки (пути, сообщения драйвера БД) наружу не отдаётся — только в лог.
  const message =
    !isProduction && error instanceof Error ? error.message : 'Внутренняя ошибка сервера';
  sendError(response, 500, 'internal_error', message);
}
