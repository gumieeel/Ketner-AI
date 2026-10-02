import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { sendError } from '../middleware/errors.js';
import { invoiceStore as defaultInvoiceStore, type InvoiceStore } from '../store/index.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UserStore } from '../store/user-store.js';
import { calculateStars } from '../telegram/bot.js';
import type { CryptoCurrency, PlanId, PlanItem } from '../types.js';
import { isVipUser } from '../services/vip.js';
import { stripeService } from '../services/stripe.js';
import { cryptoCloudService } from '../services/cryptocloud.js';

export const PLANS: readonly PlanItem[] = [
  {
    id: 'free',
    nameKey: 'pricing.free',
    priceMonthly: 0,
    limitBadge: {
      ru: 'Базовый доступ',
      en: 'Basic access',
    },
    modelsHighlight: 'Ketner Mini + Auto Mode',
    bullets: {
      ru: ['Ketner Mini (быстрая модель)', 'Интеллектуальный Auto Mode', 'Базовые функции и история чатов'],
      en: ['Ketner Mini (fast model)', 'Intelligent Auto Mode', 'Basic features & chat history'],
    },
  },
  {
    id: 'plus',
    nameKey: 'pricing.plus',
    priceMonthly: 990,
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
    priceMonthly: 1990,
    popular: true,
    limitBadge: {
      ru: 'Все флагманы AI',
      en: 'All Flagship AIs',
    },
    modelsHighlight: 'GPT-6 Astra, Claude Fable, Gemini Pro',
    bullets: {
      ru: [
        'Доступ ко ВСЕМ флагманским моделям (GPT, Claude, Gemini)',
        'Без раздельных подписок на каждого провайдера',
        'Контекст до 120 сообщений',
        '4 параллельных запроса и повышенный приоритет',
      ],
      en: [
        'Access to ALL flagship models (GPT, Claude, Gemini)',
        'No separate subscriptions per AI provider',
        'Up to 120 context messages',
        '4 concurrent requests & higher priority',
      ],
    },
  },
  {
    id: 'ultra',
    nameKey: 'pricing.ultra',
    priceMonthly: 2990,
    limitBadge: {
      ru: 'Без ограничений · Высший приоритет',
      en: 'No limits · Highest priority',
    },
    modelsHighlight: 'Максимальный контекст + 8 параллельных потоков',
    bullets: {
      ru: [
        'Всё из Pro с максимальным лимитом Fair Use',
        'До 500 сообщений контекста для больших файлов',
        '8 параллельных запросов',
        'Максимальная скорость и мгновенный отклик',
      ],
      en: [
        'Everything in Pro with highest Fair Use limits',
        'Up to 500 context messages for large codebases',
        '8 concurrent requests',
        'Maximum processing speed & instant response',
      ],
    },
  },
];

/**
 * Устаревшие тарифные планы (Legacy Plans).
 * Сохранены для пользователей со старыми подписками (цена 1199 ₽/мес ~ $12.62).
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
    priceMonthly: 1199,
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
  createLegacyPlan('claude-pro', 'pricing.claudePro', 'Claude Fable + All Pro Models'),
  createLegacyPlan('gemini-pro', 'pricing.geminiPro', 'Gemini Pro + All Pro Models'),
];

export interface BillingRouterDeps {
  subscriptionStore: SubscriptionStore;
  userStore: UserStore;
  invoiceStore?: InvoiceStore;
  defaultUserId: string;
}

export function createBillingRouter({
  subscriptionStore,
  userStore,
  invoiceStore: activeInvoiceStore = defaultInvoiceStore,
  defaultUserId,
}: BillingRouterDeps): Router {
  const router = Router();

  const getUserId = (request: {
    userId?: string;
    headers?: Record<string, string | string[] | undefined>;
  }): string => {
    const headerUserId =
      typeof request.headers?.['x-user-id'] === 'string' ? request.headers['x-user-id'] : undefined;
    return request.userId ?? headerUserId ?? defaultUserId;
  };

  const findPlan = (rawPlanId: unknown): PlanItem | undefined => {
    return (
      PLANS.find((p) => p.id === rawPlanId) ??
      LEGACY_PLANS.find((p) => p.id === rawPlanId)
    );
  };

  router.get('/plans', (request: Request, response: Response) => {
    if (request.query.includeLegacy === 'true') {
      response.json({ plans: [...PLANS, ...LEGACY_PLANS] });
      return;
    }
    response.json({ plans: PLANS });
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
    const rawPlanId: unknown = request.body?.planId;
    const validPlanIds = ['plus', 'pro', 'ultra', 'gpt-pro', 'claude-pro', 'gemini-pro'];
    if (!validPlanIds.includes(rawPlanId as string)) {
      sendError(
        response,
        400,
        'invalid_plan',
        'Допустимые тарифы для оплаты: plus, pro, ultra',
      );
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
        sendError(
          response,
          400,
          'invalid_plan',
          'Допустимые тарифы для оплаты: plus, pro, ultra',
        );
        return;
      }

      const planId = rawPlanId as PlanId;
      const userId = getUserId(request);
      const user = userStore.findById(userId);

      if (!stripeService.isAvailable()) {
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
    const rawPlanId: unknown = request.body?.planId;
    const plan = findPlan(rawPlanId);
    if (!plan || plan.priceMonthly <= 0) {
      sendError(response, 400, 'invalid_plan', 'Некорректный тариф для оплаты через СБП');
      return;
    }

    const userId = getUserId(request);
    const invoice = activeInvoiceStore.createSbpInvoice(userId, plan.id, plan.priceMonthly);

    response.json({ invoice });
  });

  const getParamInvoiceId = (req: Request): string => {
    const raw = req.params.invoiceId;
    return (Array.isArray(raw) ? raw[0] : raw) ?? '';
  };

  router.get('/billing/sbp/status/:invoiceId', (request: Request, response: Response) => {
    const invoiceId = getParamInvoiceId(request);
    const invoice = activeInvoiceStore.getSbpInvoice(invoiceId);
    if (!invoice) {
      sendError(response, 404, 'invoice_not_found', 'Счёт СБП не найден');
      return;
    }

    response.json({
      status: invoice.status,
      invoice,
    });
  });

  router.post('/billing/sbp/confirm/:invoiceId', (request: Request, response: Response) => {
    const invoiceId = getParamInvoiceId(request);
    const invoice = activeInvoiceStore.getSbpInvoice(invoiceId);
    if (!invoice) {
      sendError(response, 404, 'invoice_not_found', 'Счёт СБП не найден');
      return;
    }

    const updated = activeInvoiceStore.markSbpPaid(invoiceId) ?? invoice;
    const userId = getUserId(request) || invoice.userId;

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

  router.post('/billing/telegram-stars/create-invoice', (request: Request, response: Response) => {
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

    const userId = getUserId(request);
    const starsAmount = calculateStars(plan.priceMonthly);
    const invoice = activeInvoiceStore.createTelegramStarsInvoice(
      userId,
      plan.id,
      plan.priceMonthly,
      starsAmount,
      config.telegramBotUsername,
    );

    response.json({ invoice });
  });

  router.get('/billing/telegram-stars/status/:invoiceId', (request: Request, response: Response) => {
    const invoiceId = getParamInvoiceId(request);
    const invoice = activeInvoiceStore.getTelegramStarsInvoice(invoiceId);
    if (!invoice) {
      sendError(response, 404, 'invoice_not_found', 'Счёт Telegram Stars не найден');
      return;
    }

    response.json({
      status: invoice.status,
      invoice,
    });
  });

  router.post('/billing/telegram-stars/confirm/:invoiceId', (request: Request, response: Response) => {
    const invoiceId = getParamInvoiceId(request);
    const invoice = activeInvoiceStore.getTelegramStarsInvoice(invoiceId);
    if (!invoice) {
      sendError(response, 404, 'invoice_not_found', 'Счёт Telegram Stars не найден');
      return;
    }

    const updated = activeInvoiceStore.markTelegramStarsPaid(invoiceId) ?? invoice;
    const userId = getUserId(request) || invoice.userId;

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
  });

  // --- Crypto & CryptoCloud ---

  router.post('/billing/crypto/create-invoice', async (request: Request, response: Response) => {
    const rawPlanId: unknown = request.body?.planId;
    const plan = findPlan(rawPlanId);
    if (!plan || plan.priceMonthly <= 0) {
      sendError(response, 400, 'invalid_plan', 'Некорректный тариф для оплаты криптовалютой');
      return;
    }

    const userId = getUserId(request);
    const user = userStore.findById(userId) || userStore.findByEmail(userId);
    const currency: CryptoCurrency = request.body?.currency || 'USDT_TRC20';

    // Тарифы в долларах: Plus $9, Pro $25, Ultra $49
    const amountUsd = plan.id === 'ultra' ? 49 : plan.id === 'pro' ? 25 : 9;
    const tempOrderId = `crypto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const cryptoCodeMap: Record<string, string> = {
      USDT_TRC20: 'USDT_TRC20',
      USDT_TON: 'USDT_TON',
      TON: 'TON',
      BTC: 'BTC',
    };
    const cryptocurrency = cryptoCodeMap[currency] || 'USDT_TRC20';

    let ccResult;
    try {
      ccResult = await cryptoCloudService.createInvoice({
        orderId: tempOrderId,
        amountUsd,
        planId: plan.id,
        userId,
        userEmail: user?.email,
        cryptocurrency,
      });
    } catch (err) {
      console.warn('[billing] Ошибка создания CryptoCloud счёта:', err);
    }

    const invoice = activeInvoiceStore.createCryptoInvoice(
      userId,
      plan.id,
      currency,
      amountUsd,
      ccResult?.link,
      ccResult?.invoiceId,
      tempOrderId,
    );

    response.json({ invoice });
  });

  router.get('/billing/crypto/status/:invoiceId', async (request: Request, response: Response) => {
    const invoiceId = getParamInvoiceId(request);
    let invoice =
      activeInvoiceStore.findCryptoInvoice?.(invoiceId) ??
      activeInvoiceStore.getCryptoInvoice(invoiceId);
    if (!invoice) {
      sendError(response, 404, 'invoice_not_found', 'Крипто-счёт не найден');
      return;
    }

    // Если счёт в ожидании и привязан к CryptoCloud — проверяем статус в шлюзе
    if (invoice.status === 'pending' && invoice.cryptoCloudInvoiceId) {
      try {
        const ccStatus = await cryptoCloudService.checkInvoiceStatus(invoice.cryptoCloudInvoiceId);
        if (ccStatus === 'paid' || ccStatus === 'success' || ccStatus === 'overpaid') {
          invoice = activeInvoiceStore.markCryptoPaid(invoice.id) ?? invoice;
          subscriptionStore.checkout(invoice.userId, invoice.planId);
          const user = userStore.updatePlan(invoice.userId, invoice.planId);
          if (user?.email && user.email !== invoice.userId) {
            subscriptionStore.checkout(user.email, invoice.planId);
          }
          if (user?.id && user.id !== invoice.userId) {
            subscriptionStore.checkout(user.id, invoice.planId);
          }
          console.log(`[billing:crypto] Счёт ${invoice.id} оплачен через CryptoCloud. План ${invoice.planId} активирован.`);
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

  router.post('/billing/crypto/confirm/:invoiceId', async (request: Request, response: Response) => {
    const invoiceId = getParamInvoiceId(request);
    let invoice =
      activeInvoiceStore.findCryptoInvoice?.(invoiceId) ??
      activeInvoiceStore.getCryptoInvoice(invoiceId);
    if (!invoice) {
      sendError(response, 404, 'invoice_not_found', 'Крипто-счёт не найден');
      return;
    }

    const txHash =
      typeof request.body?.txHash === 'string' && request.body.txHash.trim().length > 0
        ? request.body.txHash.trim()
        : undefined;

    // 1. Если счёт привязан к официальному шлюзу CryptoCloud:
    if (invoice.cryptoCloudInvoiceId && cryptoCloudService.isConfigured()) {
      let isPaid = invoice.status === 'paid';
      if (!isPaid) {
        try {
          const ccStatus = await cryptoCloudService.checkInvoiceStatus(invoice.cryptoCloudInvoiceId);
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
          'Оплата ещё не подтверждена платёжной системой CryptoCloud. Пожалуйста, совершите перевод в окне TryBit и повторите проверку.',
        );
        return;
      }
    } else if (!invoice.cryptoCloudInvoiceId) {
      // 2. Прямой перевод на статический кошелёк без шлюза:
      if (!txHash) {
        sendError(
          response,
          400,
          'tx_hash_required',
          'Для подтверждения прямого перевода необходимо указать TxID (хеш транзакции из вашего кошелька).',
        );
        return;
      }

      if (txHash.length < 20) {
        sendError(
          response,
          400,
          'invalid_tx_hash',
          'Указан некорректный TxID транзакции. Хеш блокчейна должен содержать не менее 20 символов.',
        );
        return;
      }
    }

    const updated = activeInvoiceStore.markCryptoPaid(invoice.id, txHash) ?? invoice;
    const userId = getUserId(request) || invoice.userId;

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
  });

  // Webhook & Postback от CryptoCloud
  const handleCryptoCloudWebhook = (request: Request, response: Response) => {
    if (request.method === 'GET' || request.method === 'HEAD') {
      response.json({ status: 'ok', service: 'cryptocloud-webhook' });
      return;
    }
    const status = String(request.body?.status || '').toLowerCase();
    const orderId = String(request.body?.order_id || request.body?.orderId || '');
    const invoiceUuid = String(request.body?.invoice_id || request.body?.uuid || '');

    console.log('[cryptocloud] Получен webhook:', { status, orderId, invoiceUuid });

    if (status === 'success' || status === 'paid' || status === 'overpaid') {
      const invoice =
        (orderId ? activeInvoiceStore.findCryptoInvoice?.(orderId) ?? activeInvoiceStore.getCryptoInvoice(orderId) : undefined) ||
        (invoiceUuid ? activeInvoiceStore.findCryptoInvoice?.(invoiceUuid) : undefined);

      if (invoice) {
        activeInvoiceStore.markCryptoPaid(invoice.id);
        subscriptionStore.checkout(invoice.userId, invoice.planId);
        const user = userStore.updatePlan(invoice.userId, invoice.planId);
        if (user?.email && user.email !== invoice.userId) {
          subscriptionStore.checkout(user.email, invoice.planId);
        }
        if (user?.id && user.id !== invoice.userId) {
          subscriptionStore.checkout(user.id, invoice.planId);
        }
        console.log(`[cryptocloud] Подписка ${invoice.planId} активирована для ${invoice.userId}`);
      } else {
        console.warn('[cryptocloud] Не найден инвойс для webhook:', { orderId, invoiceUuid });
      }
    }

    response.json({ status: 'ok' });
  };

  router.use(
    [
      '/billing/cryptocloud/webhook',
      '/billing/cryptocloud/callback',
      '/billing/cryptocloud/postback',
      '/billing/webhook',
    ],
    handleCryptoCloudWebhook,
  );

  return router;
}
