import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { sendError } from '../middleware/errors.js';
import { invoiceStore as defaultInvoiceStore, type InvoiceStore } from '../store/index.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UserStore } from '../store/user-store.js';
import { calculateStars, telegramBotService } from '../telegram/bot.js';
import { BillingService, createBillingLedger, planLabel } from '../billing/billing-service.js';
import { isTrybitCurrency } from '../billing/trybit-currencies.js';
import type { CryptoCurrency, CryptoInvoice, PlanId, PlanItem } from '../types.js';
import { isVipUser } from '../services/vip.js';
import { stripeService } from '../services/stripe.js';
import { cryptoCloudService } from '../services/cryptocloud.js';
import {
  findPremiumPack,
  LEGACY_PRICE_USD,
  PLAN_PRICE_USD,
  planPriceRub,
  planPriceUsd,
  PREMIUM_PACK_DAYS,
  PREMIUM_PACKS,
  type PremiumPack,
} from '../services/pricing.js';
import { EntitlementService, planRank } from '../services/entitlement.js';

/** Каталог тарифов. `priceMonthly` везде в долларах США (см. services/pricing.ts). */
export const PLANS: readonly PlanItem[] = [
  {
    id: 'free',
    nameKey: 'pricing.free',
    priceMonthly: PLAN_PRICE_USD.free,
    limitBadge: {
      ru: 'Базовый доступ',
      en: 'Basic access',
    },
    modelsHighlight: 'Ketner Mini + Auto Mode',
    bullets: {
      ru: [
        'Ketner Mini (быстрая модель)',
        'Интеллектуальный Auto Mode',
        'Базовые функции и история чатов',
      ],
      en: ['Ketner Mini (fast model)', 'Intelligent Auto Mode', 'Basic features & chat history'],
    },
  },
  {
    id: 'plus',
    nameKey: 'pricing.plus',
    priceMonthly: PLAN_PRICE_USD.plus,
    limitBadge: {
      ru: 'Plus · 2 параллельных',
      en: 'Plus · 2 concurrent',
    },
    modelsHighlight: 'Ketner Pro & Mini + Auto Mode',
    bullets: {
      ru: [
        'Стандартные и продвинутые модели',
        'Auto Mode с оптимизацией себестоимости',
        'Контекст до 60 сообщений',
        '2 параллельных запроса',
      ],
      en: [
        'Standard and advanced models',
        'Auto Mode with cost optimization',
        'Up to 60 context messages',
        '2 concurrent requests',
      ],
    },
  },
  {
    id: 'pro',
    nameKey: 'pricing.pro',
    priceMonthly: PLAN_PRICE_USD.pro,
    popular: true,
    limitBadge: {
      ru: 'Все флагманы AI',
      en: 'All Flagship AIs',
    },
    modelsHighlight:
      'Claude Opus 5.5, Sonnet 5.5, GPT-6 Astra, GPT-5.6 Sol, GPT-5.6 Terra, Grok 4.7',
    bullets: {
      ru: [
        'Флагманские модели Claude, GPT и Grok',
        'Без раздельных подписок на каждого провайдера',
        'Контекст до 120 сообщений',
        '4 параллельных запроса и повышенный приоритет',
      ],
      en: [
        'Flagship Claude, GPT and Grok models',
        'No separate subscriptions per AI provider',
        'Up to 120 context messages',
        '4 concurrent requests & higher priority',
      ],
    },
  },
  {
    id: 'ultra',
    nameKey: 'pricing.ultra',
    priceMonthly: PLAN_PRICE_USD.ultra,
    limitBadge: {
      ru: 'Режим Max · Высший приоритет',
      en: 'Max mode · Highest priority',
    },
    modelsHighlight: 'Все модели Pro + режим Max',
    bullets: {
      ru: [
        'Всё из Pro и режим Max: модели думают глубже',
        'До 500 сообщений контекста для больших файлов',
        '8 параллельных запросов',
        'Максимальная скорость и мгновенный отклик',
      ],
      en: [
        'Everything in Pro plus Max mode: models think deeper',
        'Up to 500 context messages for large codebases',
        '8 concurrent requests',
        'Maximum processing speed & instant response',
      ],
    },
  },
];

/**
 * Устаревшие тарифные планы (Legacy Plans).
 * Сохранены для пользователей со старыми подписками (1199 ₽/мес ≈ $12.62; новых оплат нет).
 * Функционально эквивалентны тарифу Pro. Скрыты из публичного каталога по умолчанию,
 * доступны при запросе с query-параметром includeLegacy=true.
 */
function createLegacyPlan(
  id: 'gpt-pro' | 'claude-pro' | 'gemini-pro',
  nameKey: string,
  modelsHighlight: string,
): PlanItem {
  return {
    id,
    nameKey,
    priceMonthly: LEGACY_PRICE_USD,
    limitBadge: { ru: 'Legacy Pro', en: 'Legacy Pro' },
    modelsHighlight,
    bullets: {
      ru: ['Устаревший тариф (включает все возможности Pro)'],
      en: ['Legacy plan (includes all Pro features)'],
    },
  };
}

export const LEGACY_PLANS: readonly PlanItem[] = [
  createLegacyPlan('gpt-pro', 'pricing.gptPro', 'GPT-6 Astra + All Pro Models'),
  createLegacyPlan('claude-pro', 'pricing.claudePro', 'Claude + All Pro Models'),
  createLegacyPlan('gemini-pro', 'pricing.geminiPro', 'Gemini Pro + All Pro Models'),
];

export interface BillingRouterDeps {
  subscriptionStore: SubscriptionStore;
  userStore: UserStore;
  invoiceStore?: InvoiceStore;
  /** Журнал платежей и выдача тарифа; без него — отдельный журнал в памяти (тесты). */
  billingService?: BillingService;
}

export function createBillingRouter({
  subscriptionStore,
  userStore,
  invoiceStore: activeInvoiceStore = defaultInvoiceStore,
  billingService,
}: BillingRouterDeps): Router {
  const router = Router();
  const billing =
    billingService ??
    new BillingService({ userStore, subscriptionStore, ledger: createBillingLedger() });

  /**
   * Оплаченный крипто-счёт: тариф выдаётся один раз (с продлением или пересчётом при смене
   * тарифа), платёж попадает в журнал, в Telegram приходит чек.
   */
  const activateCrypto = (invoice: CryptoInvoice, txHash?: string) => {
    const updated = activeInvoiceStore.markCryptoPaid(invoice.id, txHash) ?? invoice;
    if (invoice.packId) {
      // Пакет премиум-квоты: кредиты на 30 дней, подписка не меняется. Тот же id платежа — без повтора.
      const pack = billing.grantPack(invoice.userId, invoice.packId, {
        id: `crypto:${invoice.id}`,
        method: 'crypto',
        amount: invoice.amountUsd,
        currency: 'USD',
        invoiceId: invoice.id,
      });
      if (!pack.duplicate) {
        void billing.telegram?.notifyUser(
          invoice.userId,
          `✅ Оплата криптовалютой получена: начислили <b>+$${pack.credit.amountUsd}</b> премиум-квоты до <b>${new Date(pack.credit.expiresAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</b>.`,
          'receipt',
        );
      }
      return {
        invoice: updated,
        subscription: subscriptionStore.get(invoice.userId),
        user: userStore.findById(invoice.userId),
        credit: pack.credit,
      };
    }
    const result = billing.grant(invoice.userId, invoice.planId, {
      id: `crypto:${invoice.id}`,
      method: 'crypto',
      amount: invoice.amountUsd,
      currency: 'USD',
      invoiceId: invoice.id,
    });
    if (!result.duplicate && result.subscription.renewsAt) {
      const until = new Date(result.subscription.renewsAt).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
      });
      void billing.telegram?.notifyUser(
        invoice.userId,
        `✅ Оплата криптовалютой получена: тариф <b>${planLabel(invoice.planId)}</b> действует до <b>${until}</b>.`,
        'receipt',
      );
    }
    return { invoice: updated, subscription: result.subscription, user: result.user };
  };

  /**
   * Идентификатор текущего пользователя. Берётся только из аутентифицированной сессии
   * (`requireAuth` гарантирует наличие `request.user`): ни заголовки, ни тело запроса,
   * ни «пользователь по умолчанию» личность не определяют.
   */
  const getUserId = (request: Request): string => request.user?.id ?? '';

  /** Счёт доступен только владельцу: чужой счёт неотличим от несуществующего (404). */
  const isOwnInvoice = (request: Request, invoice: { userId: string }): boolean => {
    const userId = getUserId(request);
    return userId !== '' && invoice.userId === userId;
  };

  /** Заглушки оплаты существуют только вне production. */
  const rejectMockInProduction = (response: Response, message: string): boolean => {
    if (config.enableMockBilling) return false;
    sendError(response, 501, 'payment_method_unavailable', message);
    return true;
  };

  const findPlan = (rawPlanId: unknown): PlanItem | undefined => {
    return PLANS.find((p) => p.id === rawPlanId) ?? LEGACY_PLANS.find((p) => p.id === rawPlanId);
  };

  /**
   * Пакет премиум-квоты из тела запроса и проверка, что его можно купить: только на платном
   * тарифе (на Free премиум-моделей нет, кредиты нечем было бы тратить). null — ответ уже отправлен.
   */
  const packForPurchase = (request: Request, response: Response): PremiumPack | null => {
    const pack = findPremiumPack(request.body?.packId);
    if (!pack) {
      sendError(response, 400, 'invalid_pack', 'Такого пакета нет');
      return null;
    }
    const user = request.user;
    const plan = EntitlementService.resolveEffectivePlan(user?.plan, user?.email, isVipUser(user));
    if (planRank(plan) < planRank('plus')) {
      sendError(
        response,
        403,
        'plan_required',
        'Пакеты премиум-квоты докупаются к подписке Plus, Pro или Ultra',
      );
      return null;
    }
    return pack;
  };

  // Webhook & Postback от CryptoCloud.
  //
  // Доверия к телу запроса нет: (1) подпись — JWT `token`, подписанный ключом проекта;
  // (2) оплата перепроверяется через API CryptoCloud по сохранённому у нас uuid счёта;
  // (3) повторная доставка не меняет состояние. Пока оба условия не выполнены, тариф не выдаётся.
  const handleCryptoCloudWebhook = async (request: Request, response: Response): Promise<void> => {
    if (request.method === 'GET' || request.method === 'HEAD') {
      response.json({ status: 'ok', service: 'cryptocloud-webhook' });
      return;
    }

    if (!cryptoCloudService.verifyPostbackToken(request.body?.token)) {
      sendError(response, 401, 'invalid_signature', 'Неверная подпись postback');
      return;
    }

    const status = String(request.body?.status || '').toLowerCase();
    const orderId = String(request.body?.order_id || request.body?.orderId || '');
    const invoiceUuid = String(request.body?.invoice_id || request.body?.uuid || '');
    console.log('[cryptocloud] Получен подписанный postback:', { status, orderId, invoiceUuid });

    if (status !== 'success' && status !== 'paid' && status !== 'overpaid') {
      response.json({ status: 'ok' });
      return;
    }

    const invoice =
      (orderId ? activeInvoiceStore.findCryptoInvoice?.(orderId) : undefined) ||
      (invoiceUuid ? activeInvoiceStore.findCryptoInvoice?.(invoiceUuid) : undefined);

    if (!invoice) {
      // 200, чтобы шлюз не повторял доставку бесконечно; в логе остаётся след.
      console.warn('[cryptocloud] Не найден счёт для postback:', { orderId, invoiceUuid });
      response.json({ status: 'ok' });
      return;
    }

    if (invoice.status === 'paid') {
      response.json({ status: 'ok', idempotentReplay: true });
      return;
    }

    if (!invoice.cryptoCloudInvoiceId) {
      console.warn(
        '[cryptocloud] У счёта нет uuid шлюза — перепроверить оплату нечем:',
        invoice.id,
      );
      response.json({ status: 'ok' });
      return;
    }

    try {
      const confirmed = await cryptoCloudService.checkInvoiceStatus(invoice.cryptoCloudInvoiceId);
      if (confirmed !== 'paid' && confirmed !== 'success' && confirmed !== 'overpaid') {
        console.warn('[cryptocloud] Postback не подтверждён API шлюза:', {
          id: invoice.id,
          confirmed,
        });
        response.json({ status: 'ok' });
        return;
      }
    } catch (err) {
      console.error('[cryptocloud] Ошибка перепроверки оплаты:', err);
      sendError(response, 502, 'gateway_check_failed', 'Не удалось подтвердить оплату у шлюза');
      return;
    }

    activateCrypto(invoice);
    console.log(`[cryptocloud] Подписка ${invoice.planId} активирована для ${invoice.userId}`);
    response.json({ status: 'ok' });
  };

  router.use(
    [
      '/billing/trybit/webhook',
      '/billing/cryptocloud/webhook',
      '/billing/cryptocloud/callback',
      '/billing/cryptocloud/postback',
      '/billing/webhook',
    ],
    handleCryptoCloudWebhook,
  );

  // Всё, что ниже, требует входа. Каталог тарифов и вебхуки платёжных систем — выше и открыты
  // (вебхуки защищаются подписью, см. C6).
  router.use('/billing', requireAuth);

  router.get('/plans', (request: Request, response: Response) => {
    if (request.query.includeLegacy === 'true') {
      response.json({ plans: [...PLANS, ...LEGACY_PLANS] });
      return;
    }
    response.json({ plans: PLANS });
  });

  // Пакеты премиум-квоты поверх подписки и кредиты пользователя.
  router.get('/billing/packs', (request: Request, response: Response) => {
    const userId = getUserId(request);
    response.json({
      packs: PREMIUM_PACKS.map((pack) => ({
        ...pack,
        days: PREMIUM_PACK_DAYS,
        stars: calculateStars(pack.priceUsd),
      })),
      credits: {
        ...billing.ledger.credits.balanceOf(userId),
        items: billing.ledger.credits.allOf(userId),
      },
    });
  });

  router.get('/billing/subscription', (request: Request, response: Response) => {
    const userId = getUserId(request);
    let subscription = subscriptionStore.get(userId);
    const user = userStore.findById(userId);
    if (isVipUser(request.user) || isVipUser(user)) {
      subscription = {
        userId,
        plan: 'ultra',
        status: 'active',
        renewsAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
      };
    }
    response.json({ subscription });
  });

  router.post('/billing/checkout', (request: Request, response: Response) => {
    // Оформление без платежа — заглушка для разработки; в production тариф даёт только оплата.
    if (
      rejectMockInProduction(
        response,
        'Оформление без оплаты недоступно. Выберите способ оплаты на странице тарифов.',
      )
    ) {
      return;
    }
    const rawPlanId: unknown = request.body?.planId;
    const validPlanIds = ['plus', 'pro', 'ultra', 'gpt-pro', 'claude-pro', 'gemini-pro'];
    if (!validPlanIds.includes(rawPlanId as string)) {
      sendError(response, 400, 'invalid_plan', 'Допустимые тарифы для оплаты: plus, pro, ultra');
      return;
    }

    const planId = rawPlanId as PlanId;
    const userId = getUserId(request);

    const subscription = subscriptionStore.checkout(userId, planId);
    const user = userStore.updatePlan(userId, planId);

    response.json({
      subscription,
      user: user ?? { id: userId, plan: planId },
    });
  });

  router.post('/billing/cancel', (request: Request, response: Response) => {
    const userId = getUserId(request);

    const subscription = subscriptionStore.cancel(userId);
    const user = userStore.updatePlan(userId, 'free');

    response.json({
      subscription,
      user: user ?? { id: userId, plan: 'free' },
    });
  });

  // --- Stripe Checkout ---

  router.post(
    '/billing/stripe/create-checkout',
    async (request: Request, response: Response): Promise<void> => {
      const rawPlanId: unknown = request.body?.planId;
      const validPlanIds = ['plus', 'pro', 'ultra', 'gpt-pro', 'claude-pro', 'gemini-pro'];
      if (!validPlanIds.includes(rawPlanId as string)) {
        sendError(response, 400, 'invalid_plan', 'Допустимые тарифы для оплаты: plus, pro, ultra');
        return;
      }

      const planId = rawPlanId as PlanId;
      const userId = getUserId(request);
      const user = userStore.findById(userId);

      if (!stripeService.isAvailable()) {
        if (rejectMockInProduction(response, 'Оплата картой временно недоступна')) {
          return;
        }
        const subscription = subscriptionStore.checkout(userId, planId);
        const updatedUser = userStore.updatePlan(userId, planId);
        response.json({
          mock: true,
          subscription,
          user: updatedUser ?? { id: userId, plan: planId },
          url: `${config.webAppUrl}/chat?billing_success=true&plan=${planId}`,
        });
        return;
      }

      try {
        const session = await stripeService.createCheckoutSession({
          userId,
          userEmail: user?.email,
          planId,
          successUrl: `${config.webAppUrl}/chat?session_id={CHECKOUT_SESSION_ID}&billing_success=true`,
          cancelUrl: `${config.webAppUrl}/pricing?canceled=true`,
        });

        response.json({ url: session.url, sessionId: session.sessionId });
      } catch (err: unknown) {
        const msg = (err as Error)?.message || 'Ошибка создания сессии Stripe';
        sendError(response, 500, 'stripe_checkout_failed', msg);
      }
    },
  );

  // --- СБП (Система быстрых платежей) ---

  router.post('/billing/sbp/create-invoice', (request: Request, response: Response) => {
    if (rejectMockInProduction(response, 'Оплата через СБП временно недоступна')) {
      return;
    }
    const rawPlanId: unknown = request.body?.planId;
    const plan = findPlan(rawPlanId);
    if (!plan || plan.priceMonthly <= 0) {
      sendError(response, 400, 'invalid_plan', 'Некорректный тариф для оплаты через СБП');
      return;
    }

    const userId = getUserId(request);
    const invoice = activeInvoiceStore.createSbpInvoice(userId, plan.id, planPriceRub(plan.id));

    response.json({ invoice });
  });

  const getParamInvoiceId = (req: Request): string => {
    const raw = req.params.invoiceId;
    return (Array.isArray(raw) ? raw[0] : raw) ?? '';
  };

  router.get('/billing/sbp/status/:invoiceId', (request: Request, response: Response) => {
    const invoiceId = getParamInvoiceId(request);
    const invoice = activeInvoiceStore.getSbpInvoice(invoiceId);
    if (!invoice || !isOwnInvoice(request, invoice)) {
      sendError(response, 404, 'invoice_not_found', 'Счёт СБП не найден');
      return;
    }

    response.json({
      status: invoice.status,
      invoice,
    });
  });

  router.post('/billing/sbp/confirm/:invoiceId', (request: Request, response: Response) => {
    // У СБП нет платёжного шлюза: «подтверждение» — заглушка, в production его нет.
    if (rejectMockInProduction(response, 'Оплата через СБП временно недоступна')) {
      return;
    }
    const invoiceId = getParamInvoiceId(request);
    const invoice = activeInvoiceStore.getSbpInvoice(invoiceId);
    if (!invoice || !isOwnInvoice(request, invoice)) {
      sendError(response, 404, 'invoice_not_found', 'Счёт СБП не найден');
      return;
    }

    const updated = activeInvoiceStore.markSbpPaid(invoiceId) ?? invoice;
    const userId = invoice.userId;

    const subscription = subscriptionStore.checkout(userId, invoice.planId);
    const user = userStore.updatePlan(userId, invoice.planId);

    response.json({
      success: true,
      subscription,
      user: user ?? { id: userId, plan: invoice.planId },
      invoice: updated,
    });
  });

  // --- Telegram Stars (⭐️ XTR) ---

  router.post(
    '/billing/telegram-stars/create-invoice',
    async (request: Request, response: Response) => {
      const userId = getUserId(request);
      if (request.body?.packId !== undefined) {
        const pack = packForPurchase(request, response);
        if (!pack) return;
        let packInvoice = activeInvoiceStore.createTelegramStarsInvoice(
          userId,
          request.user?.plan ?? 'free',
          0,
          calculateStars(pack.priceUsd),
          telegramBotService.botUsername || config.telegramBotUsername,
          pack.id,
        );
        if (telegramBotService.isConfigured) {
          const link = await telegramBotService.createInvoiceLink(packInvoice);
          if (link) {
            packInvoice = activeInvoiceStore.getTelegramStarsInvoice(packInvoice.id) ?? packInvoice;
          }
        }
        response.json({ invoice: packInvoice });
        return;
      }

      const rawPlanId: unknown = request.body?.planId;
      const plan = findPlan(rawPlanId);
      if (!plan || plan.priceMonthly <= 0) {
        sendError(
          response,
          400,
          'invalid_plan',
          'Некорректный тариф для оплаты через Telegram Stars',
        );
        return;
      }

      // Цена в звёздах — по текущему курсу Telegram Stars; сумма фиксируется в счёте.
      const starsAmount = calculateStars(planPriceUsd(plan.id));
      let invoice = activeInvoiceStore.createTelegramStarsInvoice(
        userId,
        plan.id,
        planPriceRub(plan.id),
        starsAmount,
        telegramBotService.botUsername || config.telegramBotUsername,
      );
      // Прямая ссылка на окно оплаты в Telegram; без бота остаётся ссылка на чат с ботом.
      if (telegramBotService.isConfigured) {
        const link = await telegramBotService.createInvoiceLink(invoice);
        if (link) invoice = activeInvoiceStore.getTelegramStarsInvoice(invoice.id) ?? invoice;
      }

      response.json({ invoice });
    },
  );

  router.get(
    '/billing/telegram-stars/status/:invoiceId',
    (request: Request, response: Response) => {
      const invoiceId = getParamInvoiceId(request);
      const invoice = activeInvoiceStore.getTelegramStarsInvoice(invoiceId);
      if (!invoice || !isOwnInvoice(request, invoice)) {
        sendError(response, 404, 'invoice_not_found', 'Счёт Telegram Stars не найден');
        return;
      }

      response.json({
        status: invoice.status,
        invoice,
      });
    },
  );

  router.post(
    '/billing/telegram-stars/confirm/:invoiceId',
    (request: Request, response: Response) => {
      const invoiceId = getParamInvoiceId(request);
      const invoice = activeInvoiceStore.getTelegramStarsInvoice(invoiceId);
      if (!invoice || !isOwnInvoice(request, invoice)) {
        sendError(response, 404, 'invoice_not_found', 'Счёт Telegram Stars не найден');
        return;
      }

      // Счёт становится оплаченным только когда Telegram прислал successful_payment (бот).
      // Самому клиенту «отметить оплату» нельзя; заглушка — только вне production.
      if (invoice.status !== 'paid' && !config.enableMockBilling) {
        sendError(
          response,
          402,
          'payment_not_received',
          'Оплата Stars ещё не поступила. Оплатите счёт в Telegram и повторите проверку.',
        );
        return;
      }

      const userId = invoice.userId;
      if (invoice.packId) {
        // Пакет начисляет бот по successful_payment; без бота (только вне production) — здесь.
        const paymentId = invoice.chargeId ? `stars:${invoice.chargeId}` : `stars:${invoice.id}`;
        const granted =
          invoice.status === 'paid'
            ? billing.ledger.credits.get(paymentId)
            : billing.grantPack(userId, invoice.packId, {
                id: paymentId,
                method: 'stars',
                amount: invoice.starsAmount,
                currency: 'XTR',
                invoiceId: invoice.id,
              }).credit;
        const updatedPack =
          invoice.status === 'paid'
            ? invoice
            : (activeInvoiceStore.markTelegramStarsPaid(invoiceId) ?? invoice);
        response.json({
          success: true,
          subscription: subscriptionStore.get(userId),
          user: userStore.findById(userId) ?? { id: userId, plan: invoice.planId },
          invoice: updatedPack,
          credit: granted ?? null,
        });
        return;
      }
      // Звёзды включает бот по successful_payment; здесь только отдаём результат, не продлевая повторно.
      if (invoice.status === 'paid') {
        response.json({
          success: true,
          subscription: subscriptionStore.get(userId),
          user: userStore.findById(userId) ?? { id: userId, plan: invoice.planId },
          invoice,
        });
        return;
      }
      const updated = activeInvoiceStore.markTelegramStarsPaid(invoiceId) ?? invoice;

      const subscription = subscriptionStore.checkout(userId, invoice.planId);
      const user = userStore.updatePlan(userId, invoice.planId);
      if (user?.email && user.email !== userId) {
        subscriptionStore.checkout(user.email, invoice.planId);
      }
      if (user?.id && user.id !== userId) {
        subscriptionStore.checkout(user.id, invoice.planId);
      }

      response.json({
        success: true,
        subscription,
        user: user ?? { id: userId, plan: invoice.planId },
        invoice: updated,
      });
    },
  );

  // --- Crypto & CryptoCloud ---

  router.post('/billing/crypto/create-invoice', async (request: Request, response: Response) => {
    // Счёт на тариф ({ planId }) или на пакет премиум-квоты ({ packId }).
    const isPack = request.body?.packId !== undefined;
    const pack = isPack ? packForPurchase(request, response) : null;
    if (isPack && !pack) return;
    const plan = isPack ? undefined : findPlan(request.body?.planId);
    if (!isPack && (!plan || plan.priceMonthly <= 0)) {
      sendError(response, 400, 'invalid_plan', 'Некорректный тариф для оплаты криптовалютой');
      return;
    }

    const userId = getUserId(request);
    const user = userStore.findById(userId) || userStore.findByEmail(userId);
    const requestedCurrency: unknown = request.body?.currency ?? 'USDT_TRC20';
    if (!isTrybitCurrency(requestedCurrency)) {
      sendError(response, 400, 'invalid_currency', 'Эта криптовалюта или сеть не поддерживается');
      return;
    }
    const currency: CryptoCurrency = requestedCurrency;

    // Оплата криптовалютой — только через Trybit. Без настроенного шлюза счёт не создаём
    // (в разработке шлюз подменяется заглушкой, enableMockBilling).
    if (!cryptoCloudService.isConfigured() && !config.enableMockBilling) {
      sendError(
        response,
        501,
        'payment_method_unavailable',
        'Оплата криптовалютой временно недоступна',
      );
      return;
    }

    // Цены в долларах: тарифы Plus $9, Pro $25, Ultra $49 и пакеты — services/pricing.ts
    const amountUsd = pack ? pack.priceUsd : planPriceUsd(plan!.id);
    // У счёта на пакет тариф — текущий тариф покупателя (подписка от пакета не меняется).
    const invoicePlanId = pack ? (request.user?.plan ?? 'free') : plan!.id;
    const tempOrderId = `crypto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const cryptocurrency: string = currency;

    let ccResult;
    try {
      ccResult = await cryptoCloudService.createInvoice({
        orderId: tempOrderId,
        amountUsd,
        planId: invoicePlanId,
        userId,
        userEmail: user?.email,
        cryptocurrency,
      });
    } catch (err) {
      console.warn('[billing] Ошибка создания счёта Trybit:', err);
    }
    if (!ccResult?.invoiceId) {
      sendError(
        response,
        502,
        'gateway_unavailable',
        'Trybit не выставил счёт. Попробуйте ещё раз через минуту.',
      );
      return;
    }

    const invoice = activeInvoiceStore.createCryptoInvoice(
      userId,
      invoicePlanId,
      currency,
      amountUsd,
      ccResult?.link,
      ccResult?.invoiceId,
      tempOrderId,
      ccResult?.h2h,
      pack?.id,
    );

    response.json({ invoice });
  });

  router.get('/billing/crypto/status/:invoiceId', async (request: Request, response: Response) => {
    const invoiceId = getParamInvoiceId(request);
    let invoice =
      activeInvoiceStore.findCryptoInvoice?.(invoiceId) ??
      activeInvoiceStore.getCryptoInvoice(invoiceId);
    if (!invoice || !isOwnInvoice(request, invoice)) {
      sendError(response, 404, 'invoice_not_found', 'Крипто-счёт не найден');
      return;
    }

    // Если счёт в ожидании и привязан к CryptoCloud — проверяем статус в шлюзе
    if (invoice.status === 'pending' && invoice.cryptoCloudInvoiceId) {
      try {
        const ccStatus = await cryptoCloudService.checkInvoiceStatus(invoice.cryptoCloudInvoiceId);
        if (ccStatus === 'paid' || ccStatus === 'success' || ccStatus === 'overpaid') {
          invoice = activateCrypto(invoice).invoice;
          console.log(
            `[billing:crypto] Счёт ${invoice.id} оплачен через CryptoCloud. План ${invoice.planId} активирован.`,
          );
        }
      } catch (err) {
        console.warn('[billing] Ошибка проверки статуса CryptoCloud:', err);
      }
    }

    response.json({
      status: invoice.status,
      invoice,
    });
  });

  router.post(
    '/billing/crypto/confirm/:invoiceId',
    async (request: Request, response: Response) => {
      const invoiceId = getParamInvoiceId(request);
      const invoice =
        activeInvoiceStore.findCryptoInvoice?.(invoiceId) ??
        activeInvoiceStore.getCryptoInvoice(invoiceId);
      if (!invoice || !isOwnInvoice(request, invoice)) {
        sendError(response, 404, 'invoice_not_found', 'Крипто-счёт не найден');
        return;
      }

      // Прямые переводы на кошелёк с TxID больше не принимаются: оплата только в окне Trybit.
      if (request.body?.txHash || request.body?.mode === 'manual') {
        sendError(
          response,
          400,
          'manual_transfer_unavailable',
          'Прямые переводы не принимаются. Оплатите счёт в окне Trybit на странице оплаты.',
        );
        return;
      }

      // ОПЛАТА ЧЕРЕЗ TRYBIT: статус счёта проверяется в шлюзе.
      if (invoice.cryptoCloudInvoiceId && cryptoCloudService.isConfigured()) {
        let isPaid = invoice.status === 'paid';
        if (!isPaid) {
          try {
            const ccStatus = await cryptoCloudService.checkInvoiceStatus(
              invoice.cryptoCloudInvoiceId,
            );
            if (ccStatus === 'paid' || ccStatus === 'success' || ccStatus === 'overpaid') {
              isPaid = true;
            }
          } catch (err) {
            console.warn('[billing] Ошибка проверки статуса счёта в CryptoCloud:', err);
          }
        }

        if (!isPaid) {
          sendError(
            response,
            400,
            'payment_not_received',
            'Trybit ещё не подтвердил оплату. Совершите перевод по реквизитам на странице оплаты и повторите проверку.',
          );
          return;
        }

        const userId = invoice.userId;
        // Уже оплаченный счёт (тариф включили postback или проверка статуса) второй раз не продлевает.
        if (invoice.status === 'paid') {
          response.json({
            success: true,
            subscription: subscriptionStore.get(userId),
            user: userStore.findById(userId) ?? { id: userId, plan: invoice.planId },
            invoice,
            ...(invoice.packId
              ? { credit: billing.ledger.credits.get(`crypto:${invoice.id}`) ?? null }
              : {}),
          });
          return;
        }
        const { invoice: updated, subscription, user, credit } = activateCrypto(invoice);

        response.json({
          success: true,
          subscription,
          user: user ?? { id: userId, plan: invoice.planId },
          invoice: updated,
          ...(credit ? { credit } : {}),
        });
        return;
      }

      sendError(
        response,
        400,
        'payment_not_received',
        'Trybit ещё не подтвердил оплату. Совершите перевод по реквизитам на странице оплаты и повторите проверку.',
      );
    },
  );

  return router;
}
