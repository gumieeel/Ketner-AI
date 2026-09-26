/**
 * Admin Router — управление моделями, провайдерами, мониторинг использования и рентабельности.
 *
 * Доступ защищён:
 * 1. Заголовком `x-admin-key: <ADMIN_API_KEY>`
 * 2. Или авторизацией под администраторским email из config.adminEmails (ADMIN_EMAILS)
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { config } from '../config.js';
import { sendError } from '../middleware/errors.js';
import { modelRegistry, type ModelRegistry } from '../ai/model-registry.js';
import {
  usageStore as defaultUsageStore,
  subscriptionStore as defaultSubscriptionStore,
  userStore as defaultUserStore,
  type UsageStore,
} from '../store/index.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UserStore } from '../store/user-store.js';
import type { ModelPricing } from '../ai/gateway-types.js';
import { CurrencyService } from '../services/currency.js';
import { PLANS, LEGACY_PLANS } from './billing.js';
import { isAdminUser } from '../services/vip.js';

export interface AdminRouterDeps {
  registry?: ModelRegistry;
  usageStore?: UsageStore;
  subscriptionStore?: SubscriptionStore;
  userStore?: UserStore;
}

export function createAdminRouter({
  registry = modelRegistry,
  usageStore = defaultUsageStore,
  subscriptionStore = defaultSubscriptionStore,
  userStore = defaultUserStore,
}: AdminRouterDeps = {}): Router {
  const router = Router();

  // Middleware проверки прав администратора
  const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey && adminKey === config.adminApiKey) {
      return next();
    }

    if (isAdminUser(req.user)) {
      return next();
    }

    sendError(res, 403, 'admin_access_denied', 'Требуются права администратора');
  };

  router.use(requireAdmin);

  // 1. Модели: получение всех моделей (включая неактивные)
  router.get('/models', (_req: Request, res: Response): void => {
    res.json({ models: registry.getAllIncludingDisabled() });
  });

  // 2. Модели: обновление модели (включение/выключение, цены, fallback)
  router.patch('/models/:id', (req: Request, res: Response): void => {
    const modelId = String(req.params.id);
    const model = registry.get(modelId);

    if (!model) {
      sendError(res, 404, 'model_not_found', `Модель ${modelId} не найдена`);
      return;
    }

    const body = req.body as {
      enabled?: boolean;
      pricing?: ModelPricing;
      fallbackModelId?: string | null;
      providerModelId?: string;
    };

    if (typeof body.enabled === 'boolean') {
      registry.setEnabled(modelId, body.enabled);
    }

    if (body.pricing) {
      registry.updatePricing(modelId, body.pricing);
    }

    if (body.fallbackModelId !== undefined) {
      model.fallbackModelId = body.fallbackModelId;
    }

    if (body.providerModelId) {
      model.providerModelId = body.providerModelId;
    }

    registry.upsert(model);

    res.json({ success: true, model: registry.get(modelId) });
  });

  // 3. Провайдеры: мониторинг статуса, ошибок и задержек
  router.get('/providers', (_req: Request, res: Response): void => {
    const stats = usageStore.getProviderStats();
    res.json({ providers: stats });
  });

  // 4. Использование: общая статистика токенов и расходов
  router.get('/usage', (req: Request, res: Response): void => {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;

    const stats = usageStore.getGlobalStats(from, to);
    res.json({ stats });
  });

  // 5. Рентабельность пользователя (Profitability)
  router.get('/profitability/:userId', (req: Request, res: Response): void => {
    const userId = String(req.params.userId);

    // 1. Определение реального тарифа пользователя
    const currentSub = subscriptionStore.get(userId);
    const currentUser = userStore.findById(userId);
    const userPlan = currentSub?.plan ?? currentUser?.plan ?? 'free';

    // 2. Получение цены тарифа в рублях из каталога
    const planItem = [...PLANS, ...LEGACY_PLANS].find((p) => p.id === userPlan);
    const priceRub = planItem?.priceMonthly ?? 0;

    // 3. Автоматическая конвертация в USD по актуальному курсу
    const autoPlanPriceUsd = CurrencyService.rubToUsd(priceRub);

    // 4. Опциональный ручной override через query.planPrice для тестирования
    const planPrice =
      typeof req.query.planPrice === 'string' && req.query.planPrice.trim() !== ''
        ? parseFloat(req.query.planPrice)
        : autoPlanPriceUsd;

    const report = usageStore.getUserProfitability(userId, planPrice);
    res.json({
      profitability: {
        ...report,
        plan: userPlan,
        priceRub,
        usdToRubRate: CurrencyService.getUsdToRubRate(),
      },
    });
  });

  // 6. Детальные логи запросов пользователя
  router.get('/user-usage/:userId', (req: Request, res: Response): void => {
    const userId = String(req.params.userId);
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;

    const logs = usageStore.getByUser(userId, limit);
    res.json({ usage: logs });
  });

  // 7. Обменный курс валют USD/RUB
  router.get('/exchange-rate', (_req: Request, res: Response): void => {
    res.json({
      usdToRubRate: CurrencyService.getUsdToRubRate(),
    });
  });

  router.patch('/exchange-rate', (req: Request, res: Response): void => {
    const rate = Number(req.body?.rate ?? req.body?.usdToRubRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      sendError(res, 400, 'invalid_rate', 'Поле rate должно быть положительным числом');
      return;
    }

    CurrencyService.setUsdToRubRate(rate);
    res.json({
      success: true,
      usdToRubRate: CurrencyService.getUsdToRubRate(),
    });
  });

  return router;
}
