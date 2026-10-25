/**
 * Единая точка ответа с ошибкой.
 *
 * Без неё формат ответа неизбежно разъедется между роутерами, а на фронтенде
 * его разбирает `ApiError` (apps/web/src/features/chat/api.ts).
 */
export function sendError(response, status, code, message) {
    response.status(status).json({ error: { code, message } });
}
export function notFoundHandler(request, response) {
    sendError(response, 404, 'not_found', `Эндпоинт ${request.method} ${request.originalUrl} не найден`);
}
export function errorHandler(error, _request, response, _next) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    console.error('[mock-api] необработанная ошибка:', error);
    sendError(response, 500, 'internal_error', message);
}
