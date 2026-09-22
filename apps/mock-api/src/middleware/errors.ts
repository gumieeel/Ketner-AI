import type { NextFunction, Request, Response } from 'express';

/** Единый формат ошибок API: фронтенд разбирает его в одном месте. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export function notFoundHandler(request: Request, response: Response<ApiErrorBody>): void {
  response.status(404).json({
    error: {
      code: 'not_found',
      message: `Эндпоинт ${request.method} ${request.originalUrl} не найден`,
    },
  });
}

export function errorHandler(
  error: unknown,
  _request: Request,
  response: Response<ApiErrorBody>,
  _next: NextFunction,
): void {
  const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
  console.error('[mock-api] необработанная ошибка:', error);
  response.status(500).json({
    error: {
      code: 'internal_error',
      message,
    },
  });
}
