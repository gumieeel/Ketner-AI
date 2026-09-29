import { vi } from 'vitest';
import type { ChatMeta, Conversation, ConversationSummary, Message } from '@/features/chat/types';

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
}

export interface FakeApi {
  /** Сколько раз запросили генерацию. */
  completions: number;
  /** Тела запросов на генерацию: так тесты проверяют контракт с сервером. */
  completionBodies: Array<Record<string, unknown>>;
  /** Добавляет диалог с историей, как будто он уже сохранён на сервере. */
  seed: (input: { title: string; messages?: Message[]; updatedAt?: string }) => Conversation;
}

const META: ChatMeta = {
  models: [
    {
      id: 'ketner-mini',
      name: 'Qwen 2.5 Coder',
      contextMessages: 20,
      isPro: false,
    },
    {
      id: 'gpt-6-astra',
      name: 'GPT-6 Astra *',
      contextMessages: 120,
      isPro: true,
      requiredPlan: 'gpt-pro',
    },
    {
      id: 'claude-fable',
      name: 'Claude Fable 5.5 *',
      contextMessages: 120,
      isPro: true,
      requiredPlan: 'claude-pro',
    },
    {
      id: 'gemini-pro',
      name: 'Gemini 3.8 Pro *',
      contextMessages: 120,
      isPro: true,
      requiredPlan: 'gemini-pro',
    },
    {
      id: 'ketner-pro',
      name: 'Qwen 2.5 Max *',
      contextMessages: 60,
      isPro: true,
      requiredPlan: 'ultra',
    },
  ],
  defaultModelId: 'ketner-mini',
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

const DEFAULT_REPLY = 'Ответ демонстрационной модели.';

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
function sseChunks(reply: string, fail: boolean, messageId = 'assistant-1'): string[] {
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
  let currentPlan = 'free';
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
        const name = String(body.name ?? 'Новый Пользователь');
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
              priceMonthly: 990,
              bullets: { ru: ['Быстрый отклик'], en: ['Fast speed'] },
            },
            {
              id: 'pro',
              nameKey: 'pricing.pro',
              priceMonthly: 1990,
              popular: true,
              bullets: { ru: ['Все флагманы AI'], en: ['All Flagship AIs'] },
            },
            {
              id: 'ultra',
              nameKey: 'pricing.ultra',
              priceMonthly: 2499,
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
        const priceRub = planId === 'ultra' ? 2499 : planId === 'pro' ? 1990 : 1199;
        const starsAmount = planId === 'ultra' ? 1350 : planId === 'pro' ? 1100 : 650;
        return json({
          invoice: {
            id: 'stars_mock_123',
            planId,
            priceRub,
            starsAmount,
            botUsername: 'KetnerAIBot',
            botDeepLink: `https://t.me/KetnerAIBot?start=pay_${planId}_demo-user`,
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
            priceRub: 1199,
            starsAmount: 650,
            botUsername: 'KetnerAIBot',
            botDeepLink: 'https://t.me/KetnerAIBot?start=pay_gpt-pro_demo-user',
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
            priceRub: 1199,
            starsAmount: 650,
            botUsername: 'KetnerAIBot',
            botDeepLink: 'https://t.me/KetnerAIBot?start=pay_gpt-pro_demo-user',
            status: 'paid',
            expiresAt: new Date(Date.now() + 1800000).toISOString(),
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

        const modelId = String(body.modelId ?? 'ketner-mini');
        const targetModel = META.models.find((m) => m.id === modelId) ?? META.models[0];
        const isUpgradeFail =
          Boolean(options.enforcePlans) &&
          Boolean(targetModel.isPro) &&
          (currentPlan === 'free' ||
            (targetModel.requiredPlan &&
              currentPlan !== targetModel.requiredPlan &&
              currentPlan !== 'ultra'));

        if (isUpgradeFail) {
          const upgradeChunks = [
            `event: error\ndata: ${JSON.stringify({
              code: 'upgrade_required',
              message: `Для доступа к ${targetModel.name} требуется тариф ${targetModel.requiredPlan ?? 'PRO'} или Ultra. Пожалуйста, улучшите ваш тарифный план (Upgrade your plan).`,
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
          streamOf(sseChunks(reply, fail, `assistant-${index + 1}`), delayMs, init?.signal ?? null),
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          },
        );
      }

      return json({ error: { code: 'not_found', message: `Нет обработчика для ${url}` } }, 404);
    },
  );

  return api;
}
