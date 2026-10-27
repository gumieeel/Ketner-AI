import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { sendError } from '../middleware/errors.js';
import { invoiceStore as defaultInvoiceStore, type InvoiceStore } from '../store/index.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UserStore } from '../store/user-store.js';
import { packStars, telegramBotService } from '../telegram/bot.js';
import { BillingService, createBillingLedger, planLabel } from '../billing/billing-service.js';
import { isTrybitCurrency } from '../billing/trybit-currencies.js';
import type {
  CryptoCurrency,
  CryptoInvoice,
  PlanId,
  PlanItem,
  TelegramStarsInvoice,
} from '../types.js';
import { isVipUser } from '../services/vip.js';
import { cryptoCloudService } from '../services/cryptocloud.js';
import {
  CREDIT_PACK_VALID_DAYS,
  CREDIT_PACKS,
  CRYPTO_PACK_BONUS_RATE,
  findCreditPack,
  LEGACY_PRICE_USD,
  PLAN_PRICE_USD,
  packCryptoBonusCredits,
  packPricePerThousand,
} from '../services/pricing.js';
import { TRIAL_CREDITS } from '../services/entitlement.js';

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
      ru: ['Бесплатные модели, запасная — Ketner Mini', '10 сообщений в сутки', 'История чатов'],
      en: ['Free models, Ketner Mini as backup', '10 messages a day', 'Chat history'],
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
        '500 сообщений в сутки',
        '2 параллельных запроса',
      ],
      en: [
        'Standard and advanced models',
        'Auto Mode with cost optimization',
        '500 messages a day',
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
        '1 500 сообщений в сутки',
        '4 параллельных запроса',
      ],
      en: [
        'Flagship Claude, GPT and Grok models',
        'No separate subscriptions per AI provider',
        '1,500 messages a day',
        '4 concurrent requests',
      ],
    },
  },
  {
    id: 'ultra',
    nameKey: 'pricing.ultra',
    priceMonthly: PLAN_PRICE_USD.ultra,
    limitBadge: {
      ru: 'Режим Max · Самые высокие лимиты',
      en: 'Max mode · Highest limits',
    },
    modelsHighlight: 'Все модели Pro + режим Max',
    bullets: {
      ru: [
        'Всё из Pro и режим Max: модели думают глубже',
        '4 000 сообщений в сутки',
        '8 параллельных запросов',
      ],
      en: [
        'Everything in Pro plus Max mode: models think deeper',
        '4,000 messages a day',
        '8 concurrent requests',
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
      // Пакет кредитов: кредиты на год и бонус за крипту, подписка не меняется. Тот же id платежа — без повтора.
      const pack = billing.grantPack(invoice.userId, invoice.packId, {
        id: `crypto:${invoice.id}`,
        method: 'crypto',
        amount: invoice.amountUsd,
        currency: 'USD',
        invoiceId: invoice.id,
      });
      if (!pack.duplicate) {
        const credits = Math.round(pack.credit.amountUsd * 1000);
        const bonus = pack.bonus ? Math.round(pack.bonus.amountUsd * 1000) : 0;
        void billing.telegram?.notifyUser(
          invoice.userId,
          `✅ Оплата криптовалютой получена: начислили <b>${credits.toLocaleString('ru-RU')}</b> кредитов${bonus > 0 ? ` и бонус <b>+${bonus.toLocaleString('ru-RU')}</b>` : ''} до <b>${new Date(pack.credit.expiresAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</b>.`,
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

  /**
   * Подписки больше не продаются (26.10.2026): кредиты покупают пакетами. Счета, выставленные
   * раньше, по-прежнему засчитываются вебхуком и подтверждением; действующие подписчики доживают
   * оплаченный срок.
   */
  const rejectSubscriptionPurchase = (response: Response): void => {
    sendError(
      response,
      410,
      'subscriptions_discontinued',
      'Подписок больше нет: кредиты покупаются пакетами. Выберите пакет на странице «Кредиты».',
    );
  };

  /** Пакет из тела запроса или `null` (ответ с ошибкой уже отправлен). */
  const packFromBody = (request: Request, response: Response) => {
    const pack = findCreditPack(request.body?.packId);
    if (!pack) {
      sendError(
        response,
        400,
        'invalid_pack',
        'Выберите пакет кредитов: $5, $10, $25, $50 или $100',
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
    console.log(`[cryptocloud] Счёт ${invoice.id} оплачен, начислено для ${invoice.userId}`);
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

  /**
   * Пакеты кредитов: цена в долларах и звёздах, кредиты, бонус за криптовалюту. Открыт без входа:
   * страница «Кредиты» и лендинг показывают его всем.
   */
  router.get('/packs', (_request: Request, response: Response) => {
    const base = CREDIT_PACKS[0];
    response.json({
      packs: CREDIT_PACKS.map((pack) => ({
        id: pack.id,
        priceUsd: pack.priceUsd,
        credits: pack.credits,
        stars: packStars(pack, telegramBotService.rateService),
        cryptoBonusCredits: packCryptoBonusCredits(pack),
        pricePerThousandUsd: Number(packPricePerThousand(pack).toFixed(3)),
        discountPct: Math.round(
          (1 - packPricePerThousand(pack) / packPricePerThousand(base)) * 100,
        ),
      })),
      trialCredits: TRIAL_CREDITS,
      cryptoBonusRate: CRYPTO_PACK_BONUS_RATE,
      validDays: CREDIT_PACK_VALID_DAYS,
    });
  });

  router.get('/plans', (request: Request, response: Response) => {
    if (request.query.includeLegacy === 'true') {
      response.json({ plans: [...PLANS, ...LEGACY_PLANS] });
      return;
    }
    response.json({ plans: PLANS });
  });

  /** Счёт в звёздах с ценой по официальному курсу Telegram — её показывает страница оплаты. */
  const withStarsUsd = (invoice: TelegramStarsInvoice) => ({
    ...invoice,
    starsUsd: telegramBotService.rateService.toUsd(invoice.starsAmount),
    usdPerStar: telegramBotService.rateService.rate.usdPerStar,
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
    // Оформление без платежа — заглушка для разработки; в production кредиты даёт только оплата.
    if (
      rejectMockInProduction(
        response,
        'Оформление без оплаты недоступно. Выберите способ оплаты на странице кредитов.',
      )
    ) {
      return;
    }
    if (request.body?.packId === undefined) {
      rejectSubscriptionPurchase(response);
      return;
    }
    const pack = packFromBody(request, response);
    if (!pack) return;
    const userId = getUserId(request);
    const granted = billing.grantPack(userId, pack.id, {
      id: `mock:${userId}:${Date.now()}`,
      method: 'stars',
      amount: pack.priceUsd,
      currency: 'USD',
    });
    response.json({
      subscription: subscriptionStore.get(userId),
      user: userStore.findById(userId) ?? { id: userId, plan: 'free' },
      credit: granted.credit,
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

  router.post('/billing/stripe/create-checkout', (_request: Request, response: Response) => {
    // Оплата картой отключена вместе с подписками: пакеты оплачиваются звёздами и криптовалютой.
    rejectSubscriptionPurchase(response);
  });

  // --- СБП (Система быстрых платежей) ---

  router.post('/billing/sbp/create-invoice', (_request: Request, response: Response) => {
    rejectSubscriptionPurchase(response);
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
      if (request.body?.packId === undefined) {
        rejectSubscriptionPurchase(response);
        return;
      }
      const pack = packFromBody(request, response);
      if (!pack) return;

      // Цена в звёздах — по официальному курсу Telegram Stars, но не ниже точки безубыточности;
      // сумма фиксируется в счёте.
      let invoice = activeInvoiceStore.createTelegramStarsInvoice(
        userId,
        'free',
        Math.round(pack.priceUsd * 99),
        packStars(pack, telegramBotService.rateService),
        telegramBotService.botUsername || config.telegramBotUsername,
        pack.id,
      );
      // Прямая ссылка на окно оплаты в Telegram; без бота остаётся ссылка на чат с ботом.
      if (telegramBotService.isConfigured) {
        const link = await telegramBotService.createInvoiceLink(invoice);
        if (link) invoice = activeInvoiceStore.getTelegramStarsInvoice(invoice.id) ?? invoice;
      }

      response.json({ invoice: withStarsUsd(invoice) });
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
    if (request.body?.packId === undefined) {
      rejectSubscriptionPurchase(response);
      return;
    }
    const pack = packFromBody(request, response);
    if (!pack) return;

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

    // Цена пакета в долларах — services/pricing.ts → CREDIT_PACKS.
    const amountUsd = pack.priceUsd;
    const invoicePlanId: PlanId = 'free';
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
      pack.id,
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
            `[billing:crypto] Счёт ${invoice.id} оплачен через CryptoCloud, кредиты начислены.`,
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
