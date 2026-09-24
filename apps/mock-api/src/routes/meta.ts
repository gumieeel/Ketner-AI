import { Router, type Request, type Response } from 'express';
import { MODEL_CATALOG } from '../ai/models.js';

/** Каталог моделей и лимиты планов: интерфейс берёт отсюда переключатель моделей. */
export function createMetaRouter(): Router {
  const router = Router();

  router.get('/meta', (_request: Request, response: Response) => {
    response.json(MODEL_CATALOG);
  });

  return router;
}
