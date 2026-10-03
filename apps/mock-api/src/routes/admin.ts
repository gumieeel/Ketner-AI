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
import { EntitlementService } from '../services/entitlement.js';
import type { PlanId } from '../types.js';

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

  // 4.1. Дашборд метрик шлюза (Phase 4: /api/admin/metrics)
  router.get('/metrics', (req: Request, res: Response): void => {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;

    const allUsers = userStore.list();
    const planPricesUsd: Record<string, number> = {};
    for (const plan of [...PLANS, ...LEGACY_PLANS]) {
      planPricesUsd[plan.id] = CurrencyService.rubToUsd(plan.priceMonthly);
    }

    const metrics = usageStore.getGatewayMetrics({
      fromDate: from,
      toDate: to,
      users: allUsers.map((u) => {
        const sub = subscriptionStore.get(u.id);
        const rawPlan = sub?.plan ?? u.plan ?? 'free';
        const effectivePlan = EntitlementService.resolveEffectivePlan(rawPlan, u.email, u.isVip);
        return {
          id: u.id,
          email: u.email,
          plan: effectivePlan,
          isVip: Boolean(u.isVip),
        };
      }),
      planPricesUsd,
    });

    res.json({
      metrics,
      alerts: metrics.alerts,
      hasNegativeMarginAlert: metrics.hasNegativeMarginAlert,
    });
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

  // 8. Список пользователей с кратким статусом, лимитами и расходом
  router.get('/users', (req: Request, res: Response): void => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const planFilter = typeof req.query.plan === 'string' ? req.query.plan.trim().toLowerCase() : '';
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const pageSize = Math.max(1, parseInt(String(req.query.pageSize ?? '50'), 10) || 50);

    const allUsers = userStore.list();

    const filteredUsers = allUsers.filter((u) => {
      if (search) {
        const emailMatch = u.email.toLowerCase().includes(search);
        const nameMatch = u.name.toLowerCase().includes(search);
        if (!emailMatch && !nameMatch) return false;
      }
      if (planFilter) {
        if (u.plan.toLowerCase() !== planFilter) return false;
      }
      return true;
    });

    const userCards = filteredUsers.map((u) => {
      const currentSub = subscriptionStore.get(u.id);
      const rawPlan = currentSub?.plan ?? u.plan ?? 'free';
      const effectivePlan = EntitlementService.resolveEffectivePlan(rawPlan, u.email, u.isVip);
      const entitlements = EntitlementService.getEntitlements(effectivePlan);
      const snapshot = usageStore.getFairUseSnapshot(u.id);

      const costBudget = entitlements.costBudget;
      const estimatedCostLastMonth = snapshot.estimatedCostLastMonth ?? 0;
      const budgetUsedPct =
        typeof costBudget === 'number' && costBudget > 0
          ? Math.round((estimatedCostLastMonth / costBudget) * 100)
          : 0;

      return {
        id: u.id,
        email: u.email,
        name: u.name,
        plan: u.plan,
        isVip: Boolean(u.isVip),
        isAdmin: Boolean(u.isAdmin),
        createdAt: u.createdAt,
        usage: {
          requestsToday: snapshot.requestsLastDay,
          tokensToday: snapshot.tokensLastDay,
          costToday: snapshot.estimatedCostLastDay,
          costThisMonth: snapshot.estimatedCostLastMonth,
        },
        limits: {
          requestsPerDay: entitlements.requestsPerDay ?? null,
          tokensPerDay: entitlements.tokensPerDay ?? null,
          maxDailyCost: entitlements.maxDailyCost ?? null,
          costBudget: entitlements.costBudget ?? null,
        },
        remaining: {
          requestsToday:
            entitlements.requestsPerDay !== null && entitlements.requestsPerDay !== undefined
              ? entitlements.requestsPerDay - snapshot.requestsLastDay
              : null,
          tokensToday:
            entitlements.tokensPerDay !== null && entitlements.tokensPerDay !== undefined
              ? entitlements.tokensPerDay - snapshot.tokensLastDay
              : null,
          costToday:
            entitlements.maxDailyCost !== null && entitlements.maxDailyCost !== undefined
              ? Number((entitlements.maxDailyCost - snapshot.estimatedCostLastDay).toFixed(4))
              : null,
          costThisMonth:
            entitlements.costBudget !== null && entitlements.costBudget !== undefined
              ? Number((entitlements.costBudget - snapshot.estimatedCostLastMonth).toFixed(4))
              : null,
        },
        budgetUsedPct,
      };
    });

    // Сортировка по умолчанию — по budgetUsedPct убыванию
    userCards.sort((a, b) => {
      if (b.budgetUsedPct !== a.budgetUsedPct) {
        return b.budgetUsedPct - a.budgetUsedPct;
      }
      return b.createdAt.localeCompare(a.createdAt);
    });

    const total = userCards.length;
    const startIndex = (page - 1) * pageSize;
    const paginatedUsers = userCards.slice(startIndex, startIndex + pageSize);
    const totalPages = Math.ceil(total / pageSize) || (total === 0 ? 0 : 1);

    res.json({
      users: paginatedUsers,
      total,
      page,
      pageSize,
      totalPages,
    });
  });

  // 9. Детальная карточка пользователя
  router.get('/users/:id', (req: Request, res: Response): void => {
    const userId = String(req.params.id);
    const user = userStore.findById(userId);

    if (!user) {
      sendError(res, 404, 'user_not_found', 'Пользователь не найден');
      return;
    }

    const currentSub = subscriptionStore.get(user.id);
    const rawPlan = currentSub?.plan ?? user.plan ?? 'free';
    const effectivePlan = EntitlementService.resolveEffectivePlan(rawPlan, user.email, user.isVip);
    const entitlements = EntitlementService.getEntitlements(effectivePlan);
    const snapshot = usageStore.getFairUseSnapshot(user.id);

    // 1. Получение цены тарифа в рублях из каталога
    const planItem =
      [...PLANS, ...LEGACY_PLANS].find((p) => p.id === effectivePlan) ??
      [...PLANS, ...LEGACY_PLANS].find((p) => p.id === rawPlan);
    const priceRub = planItem?.priceMonthly ?? 0;

    // 2. Автоматическая конвертация в USD по актуальному курсу
    const autoPlanPriceUsd = CurrencyService.rubToUsd(priceRub);

    // 3. Опциональный ручной override через query.planPrice для тестирования
    const planPrice =
      typeof req.query.planPrice === 'string' && req.query.planPrice.trim() !== ''
        ? parseFloat(req.query.planPrice)
        : autoPlanPriceUsd;

    const profitability = usageStore.getUserProfitability(user.id, planPrice);
    const recentRequests = usageStore.getByUser(user.id, 20);

    const costBudget = entitlements.costBudget;
    const estimatedCostLastMonth = snapshot.estimatedCostLastMonth ?? 0;
    const budgetUsedPct =
      typeof costBudget === 'number' && costBudget > 0
        ? Math.round((estimatedCostLastMonth / costBudget) * 100)
        : 0;

    const profile = {
      id: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan,
      isVip: Boolean(user.isVip),
      isAdmin: Boolean(user.isAdmin),
      createdAt: user.createdAt,
    };

    const usage = {
      requestsLastHour: snapshot.requestsLastHour,
      requestsToday: snapshot.requestsLastDay,
      tokensLastHour: snapshot.tokensLastHour,
      tokensToday: snapshot.tokensLastDay,
      costToday: snapshot.estimatedCostLastDay,
      costThisMonth: snapshot.estimatedCostLastMonth,
    };

    const limits = {
      requestsPerHour: entitlements.requestsPerHour ?? null,
      requestsPerDay: entitlements.requestsPerDay ?? null,
      tokensPerHour: entitlements.tokensPerHour ?? null,
      tokensPerDay: entitlements.tokensPerDay ?? null,
      maxDailyCost: entitlements.maxDailyCost ?? null,
      costBudget: entitlements.costBudget ?? null,
    };

    const remaining = {
      requestsLastHour:
        entitlements.requestsPerHour !== null && entitlements.requestsPerHour !== undefined
          ? entitlements.requestsPerHour - snapshot.requestsLastHour
          : null,
      requestsToday:
        entitlements.requestsPerDay !== null && entitlements.requestsPerDay !== undefined
          ? entitlements.requestsPerDay - snapshot.requestsLastDay
          : null,
      tokensLastHour:
        entitlements.tokensPerHour !== null && entitlements.tokensPerHour !== undefined
          ? entitlements.tokensPerHour - snapshot.tokensLastHour
          : null,
      tokensToday:
        entitlements.tokensPerDay !== null && entitlements.tokensPerDay !== undefined
          ? entitlements.tokensPerDay - snapshot.tokensLastDay
          : null,
      costToday:
        entitlements.maxDailyCost !== null && entitlements.maxDailyCost !== undefined
          ? Number((entitlements.maxDailyCost - snapshot.estimatedCostLastDay).toFixed(4))
          : null,
      costThisMonth:
        entitlements.costBudget !== null && entitlements.costBudget !== undefined
          ? Number((entitlements.costBudget - snapshot.estimatedCostLastMonth).toFixed(4))
          : null,
    };

    res.json({
      ...profile,
      user: profile,
      usage,
      limits,
      remaining,
      budgetUsedPct,
      profitability: {
        ...profitability,
        plan: rawPlan,
        effectivePlan,
        priceRub,
        usdToRubRate: CurrencyService.getUsdToRubRate(),
      },
      recentRequests,
    });
  });

  // 10. Точечное управление пользователем
  router.patch('/users/:id', (req: Request, res: Response): void => {
    const userId = String(req.params.id);
    const targetUser = userStore.findById(userId);

    if (!targetUser) {
      sendError(res, 404, 'user_not_found', 'Пользователь не найден');
      return;
    }

    const body = req.body as {
      plan?: unknown;
      isVip?: unknown;
      isAdmin?: unknown;
    };

    // Защита от снятия роли администратора с самого себя
    const isSelf =
      req.user !== undefined &&
      (req.user.id === targetUser.id ||
        req.user.id === userId ||
        req.user.email.toLowerCase() === targetUser.email.toLowerCase());

    if (isSelf && body.isAdmin === false) {
      sendError(res, 400, 'cannot_demote_self', 'Нельзя снять права администратора с самого себя');
      return;
    }

    const VALID_PLANS: PlanId[] = ['free', 'gpt-pro', 'claude-pro', 'gemini-pro', 'ultra', 'plus', 'pro'];
    if (body.plan !== undefined) {
      if (typeof body.plan !== 'string' || !VALID_PLANS.includes(body.plan as PlanId)) {
        sendError(res, 400, 'invalid_plan', `Недопустимый тариф: ${body.plan}`);
        return;
      }
    }

    if (body.isVip !== undefined && typeof body.isVip !== 'boolean') {
      sendError(res, 400, 'invalid_vip', 'Поле isVip должно быть булевым значением');
      return;
    }

    if (body.isAdmin !== undefined && typeof body.isAdmin !== 'boolean') {
      sendError(res, 400, 'invalid_admin', 'Поле isAdmin должно быть булевым значением');
      return;
    }

    const changes: Record<string, unknown> = {};

    if (body.plan !== undefined) {
      userStore.updatePlan(targetUser.id, body.plan as PlanId);
      subscriptionStore.checkout(targetUser.id, body.plan as PlanId);
      changes.plan = body.plan;
    }

    if (typeof body.isVip === 'boolean') {
      userStore.setVip(targetUser.id, body.isVip);
      changes.isVip = body.isVip;
    }

    if (typeof body.isAdmin === 'boolean') {
      userStore.setAdmin(targetUser.id, body.isAdmin);
      changes.isAdmin = body.isAdmin;
    }

    const actor = req.user
      ? `${req.user.email} (${req.user.id})`
      : req.headers['x-admin-key']
        ? 'admin_key'
        : 'admin';
    console.log(
      `[admin:audit] ${new Date().toISOString()} | Admin "${actor}" updated user "${targetUser.id}" (${targetUser.email}): ${JSON.stringify(changes)}`,
    );

    const updatedUser = userStore.findById(targetUser.id);
    res.json({
      success: true,
      user: updatedUser,
    });
  });

  return router;
}
