import { Router } from 'express';
import { config } from '../config.js';
import { healthRouter } from './health.js';

export const apiRouter = Router();

/**
 * Описание контракта API.
 *
 * Список отражает целевой набор эндпоинтов продукта. Реализованные помечены
 * как ready, остальные — как planned: они наполняются на этапах 2-4, при этом
 * пути и форматы ответов остаются неизменными при переходе на реальные сервисы.
 */
apiRouter.get('/', (_request, response) => {
  response.json({
    service: config.serviceName,
    version: config.version,
    endpoints: [
      { method: 'GET', path: '/api/health', status: 'ready', description: 'Проверка живости' },
      { method: 'GET', path: '/api/meta', status: 'planned', description: 'Модели и лимиты' },
      {
        method: 'POST',
        path: '/api/chat/completions',
        status: 'planned',
        description: 'Ответ ИИ (SSE)',
      },
      {
        method: 'GET',
        path: '/api/conversations',
        status: 'planned',
        description: 'Список диалогов',
      },
      {
        method: 'GET',
        path: '/api/conversations/:id',
        status: 'planned',
        description: 'Диалог с сообщениями',
      },
      {
        method: 'POST',
        path: '/api/conversations',
        status: 'planned',
        description: 'Создать диалог',
      },
      {
        method: 'PATCH',
        path: '/api/conversations/:id',
        status: 'planned',
        description: 'Переименовать диалог',
      },
      {
        method: 'DELETE',
        path: '/api/conversations/:id',
        status: 'planned',
        description: 'Удалить диалог',
      },
      {
        method: 'POST',
        path: '/api/auth/signup',
        status: 'planned',
        description: 'Регистрация (заглушка)',
      },
      {
        method: 'POST',
        path: '/api/auth/login',
        status: 'planned',
        description: 'Вход (заглушка)',
      },
      {
        method: 'GET',
        path: '/api/auth/me',
        status: 'planned',
        description: 'Текущий пользователь',
      },
      { method: 'GET', path: '/api/plans', status: 'planned', description: 'Каталог тарифов' },
      {
        method: 'POST',
        path: '/api/billing/checkout',
        status: 'planned',
        description: 'Оформление подписки (заглушка)',
      },
    ],
  });
});

apiRouter.use(healthRouter);
