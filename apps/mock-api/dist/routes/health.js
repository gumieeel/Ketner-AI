import { Router } from 'express';
import { config } from '../config.js';
export const healthRouter = Router();
/**
 * Проверка живости сервиса. Используется dev-скриптами и будет использоваться
 * проверкой готовности при деплое.
 */
healthRouter.get('/health', (_request, response) => {
    response.json({
        status: 'ok',
        service: config.serviceName,
        version: config.version,
        environment: config.nodeEnv,
        time: new Date().toISOString(),
    });
});
