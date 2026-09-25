/**
 * Admin Router — управление моделями, провайдерами, мониторинг использования и рентабельности.
 *
 * Доступ защищён:
 * 1. Заголовком `x-admin-key: <ADMIN_API_KEY>`
 * 2. Или авторизацией под администраторским email `artemsinyakov09@gmail.com`
 */
import { Router } from 'express';
import { config } from '../config.js';
import { sendError } from '../middleware/errors.js';
import { modelRegistry } from '../ai/model-registry.js';
import { usageStore as defaultUsageStore } from '../store/index.js';
export function createAdminRouter({ registry = modelRegistry, usageStore = defaultUsageStore, } = {}) {
    const router = Router();
    // Middleware проверки прав администратора
    const requireAdmin = (req, res, next) => {
        const adminKey = req.headers['x-admin-key'];
        if (adminKey && adminKey === config.adminApiKey) {
            return next();
        }
        if (req.user?.email?.toLowerCase() === 'artemsinyakov09@gmail.com') {
            return next();
        }
        sendError(res, 403, 'admin_access_denied', 'Требуются права администратора');
    };
    router.use(requireAdmin);
    // 1. Модели: получение всех моделей (включая неактивные)
    router.get('/models', (_req, res) => {
        res.json({ models: registry.getAllIncludingDisabled() });
    });
    // 2. Модели: обновление модели (включение/выключение, цены, fallback)
    router.patch('/models/:id', (req, res) => {
        const modelId = String(req.params.id);
        const model = registry.get(modelId);
        if (!model) {
            sendError(res, 404, 'model_not_found', `Модель ${modelId} не найдена`);
            return;
        }
        const body = req.body;
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
    router.get('/providers', (_req, res) => {
        const stats = usageStore.getProviderStats();
        res.json({ providers: stats });
    });
    // 4. Использование: общая статистика токенов и расходов
    router.get('/usage', (req, res) => {
        const from = typeof req.query.from === 'string' ? req.query.from : undefined;
        const to = typeof req.query.to === 'string' ? req.query.to : undefined;
        const stats = usageStore.getGlobalStats(from, to);
        res.json({ stats });
    });
    // 5. Рентабельность пользователя (Profitability)
    router.get('/profitability/:userId', (req, res) => {
        const userId = String(req.params.userId);
        const planPrice = typeof req.query.planPrice === 'string' ? parseFloat(req.query.planPrice) : 20.0;
        const report = usageStore.getUserProfitability(userId, planPrice);
        res.json({ profitability: report });
    });
    // 6. Детальные логи запросов пользователя
    router.get('/user-usage/:userId', (req, res) => {
        const userId = String(req.params.userId);
        const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;
        const logs = usageStore.getByUser(userId, limit);
        res.json({ usage: logs });
    });
    return router;
}
