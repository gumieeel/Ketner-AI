import { Router } from 'express';
import { MODEL_CATALOG } from '../ai/models.js';

/** Каталог моделей и лимиты планов: интерфейс берёт отсюда переключатель моделей. */
export function createMetaRouter(): Router {
  const router = Router();

  router.get('/meta', (_request, response) => {
    response.json(MODEL_CATALOG);
  });

  return router;
}
