import type { NextFunction, Request, Response } from 'express';

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
  const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
  console.error('[mock-api] необработанная ошибка:', error);
  sendError(response, 500, 'internal_error', message);
}
