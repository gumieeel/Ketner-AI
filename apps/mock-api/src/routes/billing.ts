import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { sendError } from '../middleware/errors.js';
import { invoiceStore as defaultInvoiceStore, usedTxStore, type InvoiceStore } from '../store/index.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UserStore } from '../store/user-store.js';
import { calculateStars } from '../telegram/bot.js';
import type { CryptoCurrency, PlanId, PlanItem } from '../types.js';
import { isVipUser } from '../services/vip.js';
import { stripeService } from '../services/stripe.js';
import { cryptoCloudService } from '../services/cryptocloud.js';
import { blockchainVerifier } from '../services/blockchain-verifier.js';

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
}

export function createBillingRouter({
  subscriptionStore,
  userStore,
  invoiceStore: activeInvoiceStore = defaultInvoiceStore,
}: BillingRouterDeps): Router {
  const router = Router();

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
    return (
      PLANS.find((p) => p.id === rawPlanId) ??
      LEGACY_PLANS.find((p) => p.id === rawPlanId)
    );
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
      console.warn('[cryptocloud] У счёта нет uuid шлюза — перепроверить оплату нечем:', invoice.id);
      response.json({ status: 'ok' });
      return;
    }

    try {
      const confirmed = await cryptoCloudService.checkInvoiceStatus(invoice.cryptoCloudInvoiceId);
      if (confirmed !== 'paid' && confirmed !== 'success' && confirmed !== 'overpaid') {
        console.warn('[cryptocloud] Postback не подтверждён API шлюза:', { id: invoice.id, confirmed });
        response.json({ status: 'ok' });
        return;
      }
    } catch (err) {
      console.error('[cryptocloud] Ошибка перепроверки оплаты:', err);
      sendError(response, 502, 'gateway_check_failed', 'Не удалось подтвердить оплату у шлюза');
      return;
    }

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
    if (!invoice || !isOwnInvoice(request, invoice)) {
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

    const updated =
      invoice.status === 'paid'
        ? invoice
        : (activeInvoiceStore.markTelegramStarsPaid(invoiceId) ?? invoice);
    const userId = invoice.userId;

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

    // Без шлюза остаётся только ручной перевод на кошелёк. Если и он выключен (production без
    // ENABLE_MANUAL_CRYPTO), принять оплату нечем — счёт не создаём, а не показываем «пустой» адрес.
    if (!cryptoCloudService.isConfigured()) {
      if (!config.manualCryptoEnabled) {
        sendError(
          response,
          501,
          'payment_method_unavailable',
          'Оплата криптовалютой временно недоступна',
        );
        return;
      }
      if (!config.enableMockBilling && currency !== 'USDT_TRC20') {
        sendError(
          response,
          400,
          'currency_unavailable',
          'Сейчас доступна оплата USDT в сети TRC-20',
        );
        return;
      }
    }

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
    if (!invoice || !isOwnInvoice(request, invoice)) {
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
    if (!invoice || !isOwnInvoice(request, invoice)) {
      sendError(response, 404, 'invoice_not_found', 'Крипто-счёт не найден');
      return;
    }

    const rawTxHash = request.body?.txHash;
    const txHash =
      typeof rawTxHash === 'string' && rawTxHash.trim().length > 0
        ? rawTxHash.trim()
        : undefined;
    const rawMode = request.body?.mode;
    const mode = rawMode === 'gateway' ? 'gateway' : rawMode === 'manual' || txHash ? 'manual' : 'gateway';

    // 1. ПРЯМОЙ ПЕРЕВОД НА КОШЕЛЁК (MANUAL BLOCKCHAIN VERIFICATION)
    if (mode === 'manual' || txHash) {
      if (!txHash) {
        sendError(
          response,
          400,
          'tx_hash_required',
          'Для подтверждения прямого перевода необходимо указать TxID (хеш транзакции из вашего кошелька).',
        );
        return;
      }

      if (!config.manualCryptoEnabled) {
        sendError(
          response,
          501,
          'payment_method_unavailable',
          'Ручное подтверждение переводов сейчас отключено',
        );
        return;
      }

      // Счёт уже оплачен — повторно ничего не активируем и второй TxID не принимаем.
      if (invoice.status === 'paid') {
        const current = subscriptionStore.get(invoice.userId);
        response.json({
          success: true,
          subscription: current,
          user: userStore.findById(invoice.userId) ?? { id: invoice.userId, plan: invoice.planId },
          invoice,
        });
        return;
      }

      // Атомарно занимаем TxID ДО сетевых запросов: два одновременных запроса с одним хешем
      // не пройдут оба (раньше проверка и запись были разделены await).
      const reserved = usedTxStore.reserveTx({
        txHash,
        userId: invoice.userId,
        planId: invoice.planId,
        currency: invoice.currency,
        amount: invoice.amount,
        createdAt: new Date().toISOString(),
      });
      if (!reserved) {
        sendError(
          response,
          400,
          'tx_already_used',
          'Этот хеш транзакции (TxID) уже был использован ранее для активации подписки. Повторное использование запрещено.',
        );
        return;
      }

      let verification;
      try {
        verification = await blockchainVerifier.verifyTransaction({
          txHash,
          currency: invoice.currency,
          requiredUsd: invoice.amountUsd,
          planId: invoice.planId,
          userId: invoice.userId,
          invoiceCreatedAt: invoice.createdAt,
        });
      } catch (err) {
        usedTxStore.releaseTx(txHash);
        console.error('[billing] Ошибка проверки транзакции:', err);
        sendError(response, 502, 'blockchain_verification_failed', 'Не удалось проверить транзакцию. Повторите позже.');
        return;
      }

      if (!verification.success) {
        // Проверка не удалась — хеш освобождается, чтобы после подтверждения сети его можно было подать снова.
        usedTxStore.releaseTx(txHash);
        sendError(
          response,
          400,
          verification.errorCode || 'blockchain_verification_failed',
          verification.errorMessage || 'Не удалось подтвердить транзакцию в блокчейне.',
        );
        return;
      }

      // Фиксируем фактическую сумму и время блока
      usedTxStore.recordUsedTx({
        txHash,
        userId: invoice.userId,
        planId: invoice.planId,
        currency: invoice.currency,
        amount: verification.transferredAmount ?? invoice.amount,
        createdAt: new Date().toISOString(),
        blockTimestamp: verification.blockTimestamp,
      });

      const updated = activeInvoiceStore.markCryptoPaid(invoice.id, txHash) ?? invoice;
      const userId = invoice.userId;

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
        verification,
      });
      return;
    }

    // 2. ОПЛАТА ЧЕРЕЗ ШЛЮЗ CRYPTOCLOUD / TRYBIT (GATEWAY VERIFICATION)
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

      const updated = activeInvoiceStore.markCryptoPaid(invoice.id) ?? invoice;
      const userId = invoice.userId;

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
      return;
    }

    sendError(
      response,
      400,
      'payment_not_received',
      'Оплата не подтверждена. Пожалуйста, совершите перевод и укажите TxID транзакции.',
    );
  });


  return router;
}
