import { vi } from 'vitest';
import type { ChatMeta, Conversation, ConversationSummary, Message } from '@/features/chat/types';

/** Код из «письма» регистрации, который принимает фейковый API. */
export const FAKE_SIGNUP_CODE = '123456';

export interface FakeApiOptions {
  /** Ответ ассистента по умолчанию. */
  reply?: string;
  /** Ответы по очереди: i-й запрос берёт replies[i % length]. */
  replies?: string[];
  /** Задержка между порциями ответа, мс. */
  chunkDelayMs?: number;
  /** Сколько первых запросов завершить событием error. */
  failTimes?: number;
  /** Проверять ли доступность моделей по тарифу. */
  enforcePlans?: boolean;
  /** Начальный тариф пользователя. */
  plan?: string;
  /** Модель, которая «реально ответила» (приходит в событии done, как у сервера). */
  servedModelId?: string;
  /** После скольких генераций сервер отвечает 429 rate_limited (лимиты считает сервер). */
  rateLimitAfter?: number;
  /** Привязанный аккаунт GitHub: по умолчанию не подключён. */
  github?: { connected: boolean; login?: string };
  /** Ответ GET /api/usage/quota (по умолчанию 404: строка остатка не показывается). */
  quota?: (mode: 'standard' | 'max') => unknown;
}

export interface FakeApi {
  /** Сколько раз запросили генерацию. */
  completions: number;
  /** Тела запросов на генерацию: так тесты проверяют контракт с сервером. */
  completionBodies: Array<Record<string, unknown>>;
  /** Добавляет диалог с историей, как будто он уже сохранён на сервере. */
  seed: (input: { title: string; messages?: Message[]; updatedAt?: string }) => Conversation;
}

/** Зеркало публичного каталога сервера (apps/mock-api/src/ai/models.ts): id, названия, requiredPlan. */
const META: ChatMeta = {
  models: [
    {
      id: 'auto',
      name: '✨ Auto (Smart Router)',
      contextMessages: 120,
      isPro: false,
    },
    {
      id: 'ketner-mini',
      name: 'Ketner Mini',
      contextMessages: 40,
      isPro: false,
    },
    {
      id: 'ketner-pro',
      name: 'Ketner Pro',
      contextMessages: 60,
      isPro: true,
      requiredPlan: 'plus',
    },
    {
      id: 'claude-haiku-5.5',
      name: 'Claude Haiku 5.5',
      contextMessages: 40,
      isPro: true,
      requiredPlan: 'plus',
    },
    {
      id: 'deepseek-v4.1-flash',
      name: 'DeepSeek V4.1 Flash',
      contextMessages: 40,
      isPro: true,
      requiredPlan: 'plus',
    },
    {
      id: 'gemini-3.8-flash',
      name: 'Gemini 3.8 Flash',
      contextMessages: 120,
      isPro: true,
      requiredPlan: 'pro',
    },
    {
      id: 'grok-4.7',
      name: 'Grok 4.7',
      contextMessages: 120,
      isPro: true,
      requiredPlan: 'pro',
    },
    {
      id: 'gpt-6.1-sol',
      name: 'GPT-6.1 Sol',
      contextMessages: 120,
      isPro: true,
      requiredPlan: 'plus',
    },
    {
      id: 'claude-opus-5.5',
      name: 'Claude Opus 5.5',
      contextMessages: 120,
      isPro: true,
      requiredPlan: 'pro',
    },
  ],
  defaultModelId: 'auto',
  limits: {
    free: { messagesPerDay: 10, contextMessages: 20 },
    'gpt-pro': { messagesPerDay: null, contextMessages: 120 },
    'claude-pro': { messagesPerDay: null, contextMessages: 120 },
    'gemini-pro': { messagesPerDay: null, contextMessages: 120 },
    ultra: { messagesPerDay: null, contextMessages: 500 },
    plus: { messagesPerDay: null, contextMessages: 60 },
    pro: { messagesPerDay: null, contextMessages: 120 },
  },
};

/** Зеркало PLAN_RANKS сервера (apps/mock-api/src/services/entitlement.ts): модель доступна, если ранг тарифа не ниже требуемого. */
const PLAN_RANKS: Record<string, number> = {
  free: 0,
  plus: 1,
  pro: 2,
  'gpt-pro': 2,
  'claude-pro': 2,
  'gemini-pro': 2,
  ultra: 3,
};

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
  ultra: 'Ultra',
};

function planRank(plan: string | undefined): number {
  return plan ? (PLAN_RANKS[plan] ?? 0) : 0;
}

const DEFAULT_REPLY = 'Ответ модели Ketner AI.';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function notFound(): Response {
  return json({ error: { code: 'conversation_not_found', message: 'Диалог не найден' } }, 404);
}

/** Готовит поток SSE: несколько порций текста и финальное событие. */
function sseChunks(
  reply: string,
  fail: boolean,
  messageId = 'assistant-1',
  servedModelId?: string,
): string[] {
  if (fail) {
    return [
      `event: error\ndata: ${JSON.stringify({
        code: 'upstream_error',
        message: 'Модель недоступна',
      })}\n\n`,
    ];
  }

  const words = reply.split(' ');
  const perChunk = Math.max(1, Math.ceil(words.length / 4));
  const chunks: string[] = [];

  for (let index = 0; index < words.length; index += perChunk) {
    const isLast = index + perChunk >= words.length;
    const text = words.slice(index, index + perChunk).join(' ') + (isLast ? '' : ' ');
    chunks.push(`event: delta\ndata: ${JSON.stringify({ content: text })}\n\n`);
  }

  chunks.push(
    `event: done\ndata: ${JSON.stringify({
      messageId,
      ...(servedModelId ? { selectedModel: { id: servedModelId, name: servedModelId } } : {}),
      usage: { inputTokens: 12, outputTokens: 24 },
    })}\n\n`,
  );
  return chunks;
}

function streamOf(chunks: string[], delayMs: number, signal: AbortSignal | null): ReadableStream {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let index = 0;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (): void => {
        if (signal?.aborted) {
          return;
        }
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(chunks[index]));
        index += 1;
        timer = setTimeout(push, delayMs);
      };

      signal?.addEventListener('abort', () => {
        if (timer !== null) {
          clearTimeout(timer);
        }
        try {
          controller.error(new DOMException('Aborted', 'AbortError'));
        } catch {
          // Поток уже закрыт — ничего страшного.
        }
      });

      push();
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
      }
    },
  });
}

/**
 * Подменяет fetch фейковым mock-API.
 *
 * Проверяет клиент целиком: REST-запросы, SSE-поток, отмену и ошибки.
 */
export function installFakeApi(options: FakeApiOptions = {}): FakeApi {
  const delayMs = options.chunkDelayMs ?? 1;
  let currentPlan = options.plan ?? 'free';
  let githubConnected = options.github?.connected ?? false;
  const githubStatus = () => ({
    available: true,
    connected: githubConnected,
    account: githubConnected
      ? {
          login: options.github?.login ?? 'octo',
          avatarUrl: null,
          scopes: ['repo', 'read:user'],
          connectedAt: '2026-10-01T10:00:00.000Z',
        }
      : null,
  });
  const conversations = new Map<string, { conversation: Conversation; messages: Message[] }>();
  const api: FakeApi = {
    completions: 0,
    completionBodies: [],
    seed({ title, messages = [], updatedAt }) {
      const now = updatedAt ?? new Date().toISOString();
      const conversation: Conversation = {
        id: `conversation-${conversations.size + 1}`,
        userId: 'demo-user',
        title,
        createdAt: now,
        updatedAt: now,
      };
      conversations.set(conversation.id, { conversation, messages });
      return conversation;
    },
  };

  let pendingSignupEmail = '';
  let pendingSignupName = '';

  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body =
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};

      if (url === '/api/meta') {
        return json(META);
      }

      if (url === '/api/auth/login' && method === 'POST') {
        const email = String(body.email ?? '');
        const password = String(body.password ?? '');
        if (password === 'wrongPassword') {
          return json({ error: { code: 'invalid_credentials', message: 'Неверный пароль' } }, 401);
        }
        return json({
          user: {
            id: 'demo-user',
            email,
            name: 'Демо Пользователь',
            plan: 'free',
            createdAt: new Date().toISOString(),
          },
          token: 'fake.jwt.token',
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        });
      }

      if (url === '/api/auth/signup' && method === 'POST') {
        const email = String(body.email ?? '');
        pendingSignupName = String(body.name ?? 'Новый Пользователь');
        pendingSignupEmail = email;
        return json(
          {
            status: 'verification_required',
            signupId: 'signup-1',
            email,
            codeExpiresAt: new Date(Date.now() + 600_000).toISOString(),
            resendAfterSec: 60,
          },
          202,
        );
      }

      if (url === '/api/auth/signup/resend' && method === 'POST') {
        return json({
          status: 'verification_required',
          email: pendingSignupEmail,
          codeExpiresAt: new Date(Date.now() + 600_000).toISOString(),
          resendAfterSec: 60,
        });
      }

      if (url === '/api/auth/signup/verify' && method === 'POST') {
        if (body.code !== FAKE_SIGNUP_CODE) {
          return json(
            { error: { code: 'invalid_code', message: 'Неверный код. Осталось попыток: 4' } },
            400,
          );
        }
        const email = pendingSignupEmail;
        const name = pendingSignupName;
        return json(
          {
            user: {
              id: 'new-user',
              email,
              name,
              plan: 'free',
              createdAt: new Date().toISOString(),
            },
            token: 'fake.jwt.token',
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          },
          201,
        );
      }

      if (url === '/api/auth/me' && method === 'GET') {
        const authHeader =
          init?.headers && 'Authorization' in init.headers
            ? (init.headers as Record<string, string>)['Authorization']
            : undefined;
        if (!authHeader) {
          return json({ error: { code: 'unauthorized', message: 'Требуется авторизация' } }, 401);
        }
        return json({
          user: {
            id: 'demo-user',
            email: 'demo@ketner.ai',
            name: 'Демо Пользователь',
            plan: currentPlan,
            createdAt: new Date().toISOString(),
          },
        });
      }

      if (url === '/api/auth/logout' && method === 'POST') {
        return new Response(null, { status: 204 });
      }

      if (url.startsWith('/api/auth/oauth/')) {
        const provider = url.split('/').pop();
        return json({
          user: {
            id: 'oauth-user',
            email: `user@${provider}.com`,
            name: `${provider} User`,
            plan: 'free',
            createdAt: new Date().toISOString(),
          },
          token: 'fake.oauth.jwt.token',
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          provider,
        });
      }

      if (url === '/api/plans') {
        return json({
          plans: [
            {
              id: 'free',
              nameKey: 'pricing.free',
              priceMonthly: 0,
              bullets: { ru: ['Базовая скорость'], en: ['Standard speed'] },
            },
            {
              id: 'plus',
              nameKey: 'pricing.plus',
              priceMonthly: 9,
              bullets: { ru: ['Быстрый отклик'], en: ['Fast speed'] },
            },
            {
              id: 'pro',
              nameKey: 'pricing.pro',
              priceMonthly: 25,
              popular: true,
              bullets: { ru: ['Все флагманы AI'], en: ['All Flagship AIs'] },
            },
            {
              id: 'ultra',
              nameKey: 'pricing.ultra',
              priceMonthly: 49,
              bullets: { ru: ['Максимум · VIP'], en: ['Maximum · VIP'] },
            },
          ],
        });
      }

      if (url === '/api/billing/subscription' && method === 'GET') {
        return json({
          subscription: {
            userId: 'demo-user',
            plan: 'free',
            status: 'active',
            renewsAt: null,
          },
        });
      }

      if (url === '/api/billing/checkout' && method === 'POST') {
        const planId = (body.planId as string) || 'plus';
        currentPlan = planId;
        return json({
          subscription: {
            userId: 'demo-user',
            plan: planId,
            status: 'active',
            renewsAt: new Date(Date.now() + 86400000 * 30).toISOString(),
          },
          user: {
            id: 'demo-user',
            plan: planId,
          },
        });
      }

      if (url === '/api/billing/cancel' && method === 'POST') {
        currentPlan = 'free';
        return json({
          subscription: {
            userId: 'demo-user',
            plan: 'free',
            status: 'canceled',
            renewsAt: null,
          },
          user: {
            id: 'demo-user',
            plan: 'free',
          },
        });
      }

      if (url === '/api/billing/sbp/create-invoice' && method === 'POST') {
        const planId = (body.planId as string) || 'gpt-pro';
        return json({
          invoice: {
            id: 'sbp_mock_123',
            planId,
            amount: 1199,
            currency: 'RUB',
            status: 'pending',
            qrPayload: 'https://qr.nspk.ru/AD10000KETNERAI_sbp_mock_123',
            deepLink: 'https://qr.nspk.ru/AD10000KETNERAI_sbp_mock_123',
            expiresAt: new Date(Date.now() + 900000).toISOString(),
          },
        });
      }

      if (url.startsWith('/api/billing/sbp/status/') && method === 'GET') {
        return json({
          status: 'pending',
          invoice: {
            id: 'sbp_mock_123',
            planId: 'gpt-pro',
            amount: 1199,
            currency: 'RUB',
            status: 'pending',
            qrPayload: 'https://qr.nspk.ru/AD10000KETNERAI_sbp_mock_123',
            deepLink: 'https://qr.nspk.ru/AD10000KETNERAI_sbp_mock_123',
            expiresAt: new Date(Date.now() + 900000).toISOString(),
          },
        });
      }

      if (url.startsWith('/api/billing/sbp/confirm/') && method === 'POST') {
        currentPlan = 'gpt-pro';
        return json({
          success: true,
          subscription: {
            userId: 'demo-user',
            plan: 'gpt-pro',
            status: 'active',
            renewsAt: new Date(Date.now() + 86400000 * 30).toISOString(),
          },
          user: {
            id: 'demo-user',
            plan: 'gpt-pro',
          },
          invoice: {
            id: 'sbp_mock_123',
            planId: 'gpt-pro',
            amount: 1199,
            currency: 'RUB',
            status: 'paid',
            qrPayload: 'https://qr.nspk.ru/AD10000KETNERAI_sbp_mock_123',
            deepLink: 'https://qr.nspk.ru/AD10000KETNERAI_sbp_mock_123',
            expiresAt: new Date(Date.now() + 900000).toISOString(),
          },
        });
      }

      if (url === '/api/billing/telegram-stars/create-invoice' && method === 'POST') {
        const planId = (body.planId as string) || 'gpt-pro';
        const priceRub = planId === 'ultra' ? 4890 : planId === 'pro' ? 2490 : 890;
        // Как на сервере: цена тарифа по официальному курсу Telegram.
        const starsAmount = planId === 'ultra' ? 2460 : planId === 'pro' ? 1260 : 460;
        return json({
          invoice: {
            id: 'stars_mock_123',
            planId,
            priceRub,
            starsAmount,
            starsUsd: Math.round(starsAmount * 0.01999 * 100) / 100,
            usdPerStar: 0.01999,
            botUsername: 'Robo_kassa_bot',
            botDeepLink: `https://t.me/Robo_kassa_bot?start=pay_${planId}_demo-user`,
            status: 'pending',
            expiresAt: new Date(Date.now() + 1800000).toISOString(),
          },
        });
      }

      if (url.startsWith('/api/billing/telegram-stars/status/') && method === 'GET') {
        return json({
          status: 'pending',
          invoice: {
            id: 'stars_mock_123',
            planId: 'gpt-pro',
            priceRub: 2490,
            starsAmount: 1260,
            botUsername: 'Robo_kassa_bot',
            botDeepLink: 'https://t.me/Robo_kassa_bot?start=pay_gpt-pro_demo-user',
            status: 'pending',
            expiresAt: new Date(Date.now() + 1800000).toISOString(),
          },
        });
      }

      if (url.startsWith('/api/billing/telegram-stars/confirm/') && method === 'POST') {
        currentPlan = 'gpt-pro';
        return json({
          success: true,
          subscription: {
            userId: 'demo-user',
            plan: 'gpt-pro',
            status: 'active',
            renewsAt: new Date(Date.now() + 86400000 * 30).toISOString(),
          },
          user: {
            id: 'demo-user',
            plan: 'gpt-pro',
          },
          invoice: {
            id: 'stars_mock_123',
            planId: 'gpt-pro',
            priceRub: 2490,
            starsAmount: 1260,
            botUsername: 'Robo_kassa_bot',
            botDeepLink: 'https://t.me/Robo_kassa_bot?start=pay_gpt-pro_demo-user',
            status: 'paid',
            expiresAt: new Date(Date.now() + 1800000).toISOString(),
          },
        });
      }

      if (url === '/api/billing/crypto-bonus' && method === 'GET') {
        return json({
          pct: 15,
          plans: {
            plus: { quotaUsd: 1.3, bonusUsd: 0.2 },
            pro: { quotaUsd: 8, bonusUsd: 1.2 },
            ultra: { quotaUsd: 16.5, bonusUsd: 2.48 },
          },
        });
      }

      if (url === '/api/billing/crypto/create-invoice' && method === 'POST') {
        const planId = (body.planId as string) || 'plus';
        const currency = (body.currency as string) || 'USDT_TRC20';
        const amountUsd = planId === 'ultra' ? 49 : planId === 'pro' ? 25 : 9;
        const amount =
          currency === 'TON'
            ? +(amountUsd / 5.4).toFixed(2)
            : currency === 'BTC'
              ? +(amountUsd / 95000).toFixed(6)
              : amountUsd;
        return json({
          invoice: {
            id: 'crypto_mock_123',
            planId,
            currency,
            amount,
            amountUsd,
            address:
              currency === 'USDT_TRC20'
                ? 'TTrybitH2hDemoAddrUsdtTrc20xxxxxx'
                : currency === 'BTC'
                  ? 'bc1qtrybith2hdemoaddressbtc0000000000xx'
                  : 'UQTrybitH2hDemoAddressTon000000000000000000000000',
            qrPayload:
              currency === 'USDT_TRC20'
                ? `tron:TTrybitH2hDemoAddrUsdtTrc20xxxxxx?amount=${amount}`
                : `ton://transfer/UQTrybitH2hDemoAddressTon000000000000000000000000?amount=${amount}`,
            status: 'pending',
            expiresAt: new Date(Date.now() + 1800000).toISOString(),
            network: currency === 'USDT_TRC20' ? 'TRC-20' : currency === 'BTC' ? 'Bitcoin' : 'TON',
            cryptoCloudUrl: 'https://pay.trybit.com/DEMO123',
            // Trybit выдал реквизиты (H2H): оплата прямо на сайте.
            gatewayDetails: true,
            // Комиссии из счёта Trybit: сервис 1,9 % + перевод по Tron, обе на покупателе.
            fees: {
              serviceUsd: 0.17,
              transferUsd: currency === 'USDT_TRC20' ? 1.4 : 0,
              payerUsd: +(0.17 + (currency === 'USDT_TRC20' ? 1.4 : 0)).toFixed(2),
              totalUsd: +(amountUsd + 0.17 + (currency === 'USDT_TRC20' ? 1.4 : 0)).toFixed(2),
            },
          },
        });
      }

      if (url.startsWith('/api/billing/crypto/status/') && method === 'GET') {
        return json({
          status: 'pending',
          invoice: {
            id: 'crypto_mock_123',
            planId: 'plus',
            currency: 'USDT_TRC20',
            amount: 10,
            amountUsd: 10,
            address: 'TTrybitH2hDemoAddrUsdtTrc20xxxxxx',
            qrPayload: 'tron:TTrybitH2hDemoAddrUsdtTrc20xxxxxx?amount=10',
            status: 'pending',
            expiresAt: new Date(Date.now() + 1800000).toISOString(),
            network: 'TRC-20',
            cryptoCloudUrl: 'https://cryptocloud.plus/pay/INV-DEMO123',
          },
        });
      }

      if (url.startsWith('/api/billing/crypto/confirm/') && method === 'POST') {
        currentPlan = 'plus';
        return json({
          success: true,
          subscription: {
            userId: 'demo-user',
            plan: 'plus',
            status: 'active',
            renewsAt: new Date(Date.now() + 86400000 * 30).toISOString(),
          },
          user: {
            id: 'demo-user',
            plan: 'plus',
          },
          invoice: {
            id: 'crypto_mock_123',
            planId: 'plus',
            currency: 'USDT_TRC20',
            amount: 10,
            amountUsd: 10,
            address: 'TTrybitH2hDemoAddrUsdtTrc20xxxxxx',
            qrPayload: 'tron:TTrybitH2hDemoAddrUsdtTrc20xxxxxx?amount=10',
            status: 'paid',
            expiresAt: new Date(Date.now() + 1800000).toISOString(),
            network: 'TRC-20',
          },
        });
      }

      if (url === '/api/conversations' && method === 'GET') {
        const list: ConversationSummary[] = [...conversations.values()].map(
          ({ conversation, messages }) => ({
            ...conversation,
            messageCount: messages.length,
          }),
        );
        return json({ conversations: list });
      }

      if (url === '/api/conversations' && method === 'POST') {
        return json({ conversation: api.seed({ title: String(body.title ?? '') }) }, 201);
      }

      const conversationId = /^\/api\/conversations\/(.+)$/.exec(url)?.[1];
      if (conversationId !== undefined) {
        const found = conversations.get(decodeURIComponent(conversationId));
        if (!found) {
          return notFound();
        }
        if (method === 'DELETE') {
          conversations.delete(found.conversation.id);
          return new Response(null, { status: 204 });
        }
        if (method === 'PATCH') {
          found.conversation = { ...found.conversation, title: String(body.title ?? '') };
          return json({ conversation: found.conversation });
        }
        return json(found);
      }

      if (url === '/api/chat/completions' && method === 'POST') {
        const index = api.completions;
        api.completions += 1;
        api.completionBodies.push(body);

        if (options.rateLimitAfter !== undefined && index >= options.rateLimitAfter) {
          return json(
            {
              error: {
                code: 'rate_limited',
                message: 'Сообщения на это время закончились. Попробуйте позже.',
              },
            },
            429,
          );
        }

        const modelId = String(body.modelId ?? 'ketner-mini');
        const targetModel = META.models.find((m) => m.id === modelId) ?? META.models[0];
        const requiredPlan = targetModel.isPro ? (targetModel.requiredPlan ?? 'plus') : undefined;
        const isUpgradeFail =
          Boolean(options.enforcePlans) && planRank(currentPlan) < planRank(requiredPlan);

        if (isUpgradeFail) {
          const upgradeChunks = [
            `event: error\ndata: ${JSON.stringify({
              code: 'upgrade_required',
              message: `Доступ к модели ${targetModel.name} требует подписки ${PLAN_LABELS[requiredPlan ?? 'plus'] ?? requiredPlan} или выше. Пожалуйста, улучшите ваш тарифный план (Upgrade your plan).`,
            })}\n\n`,
          ];
          return new Response(streamOf(upgradeChunks, delayMs, init?.signal ?? null), {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          });
        }

        const fail = index < (options.failTimes ?? 0);
        const reply =
          options.replies?.[index % options.replies.length] ?? options.reply ?? DEFAULT_REPLY;
        const convId = String(body.conversationId ?? '');
        const found = conversations.get(convId);
        if (found && !fail) {
          const incoming = Array.isArray(body.messages) ? (body.messages as Message[]) : [];
          found.messages = [
            ...incoming,
            {
              id: `assistant-${index + 1}`,
              conversationId: convId,
              role: 'assistant',
              content: reply,
              createdAt: new Date().toISOString(),
              status: 'complete',
            },
          ];
        }
        return new Response(
          streamOf(
            sseChunks(reply, fail, `assistant-${index + 1}`, options.servedModelId),
            delayMs,
            init?.signal ?? null,
          ),
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          },
        );
      }

      if (url.startsWith('/api/usage/quota') && options.quota) {
        return json(options.quota(url.includes('mode=max') ? 'max' : 'standard'));
      }

      if (url === '/api/github/status') {
        return json(githubStatus());
      }
      if (url === '/api/github/connection' && method === 'DELETE') {
        githubConnected = false;
        return json(githubStatus());
      }
      if (url.startsWith('/api/github/connect-url')) {
        return json({ url: 'https://github.com/login/oauth/authorize?client_id=test' });
      }

      return json({ error: { code: 'not_found', message: `Нет обработчика для ${url}` } }, 404);
    },
  );

  return api;
}
