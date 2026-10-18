import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBetterAuth, initAuthDatabase } from '../auth/better-auth.js';
import { createApp, type AppDeps } from '../app.js';
import type { AiConfig } from '../config.js';
import { DEFAULT_MODEL_ID } from '../ai/models.js';
import { createConversationStore } from '../store/conversation-store.js';
import { createSubscriptionStore } from '../store/subscription-store.js';
import { createUserStore } from '../store/user-store.js';
import { createApiKeyStore, type ApiKeyStore } from '../store/api-key-store.js';
import { createRevokedTokenStore } from '../store/revoked-token-store.js';
import { UsageStore } from '../store/usage-store.js';
import { createInvoiceStore } from '../store/invoice-store.js';
import {
  createGithubConnectionStore,
  type GithubConnectionStore,
} from '../github/connection-store.js';
import { semanticCache } from '../ai/cache.js';
import { AIGateway } from '../ai/gateway.js';
import type { Conversation, Message } from '../types.js';

import { createSupportStore } from '../store/support-store.js';
import { TelegramSupportBotService } from '../telegram/support-bot.js';
import type { MailMessage, Mailer } from '../services/mailer.js';
import { isCodeMail, rememberCodeMails } from './signup.js';

/** Задержки без пауз: тесты не должны ждать стриминг. */
export const FAST_AI: AiConfig = {
  thinkingMs: [0, 0],
  chunkMs: [0, 0],
  failureRate: 0,
  random: () => 0,
};

export interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
  /** Хранилища сервера: тесты создают ключи и сеют расход напрямую. */
  usageStore: UsageStore;
  apiKeyStore: ApiKeyStore;
  githubConnectionStore: GithubConnectionStore;
  /** Письма с кодами регистрации и входа. */
  codeMails: MailMessage[];
}

/** Поднимает приложение на свободном порту с временным файлом хранилища. */
export async function startTestServer(
  ai: Partial<AiConfig> = {},
  extra: Partial<AppDeps> = {},
): Promise<TestServer> {
  const tempDir = mkdtempSync(join(tmpdir(), 'ketner-mock-api-'));
  const storeFile = join(tempDir, 'store.json');
  const userStoreFile = join(tempDir, 'users.json');
  const subscriptionStoreFile = join(tempDir, 'subscriptions.json');
  const authDbFile = join(tempDir, 'auth.sqlite');
  const supportStoreFile = join(tempDir, 'support.json');

  const { auth: testBetterAuth, db: testAuthDb } = createBetterAuth({ dbPath: authDbFile });
  await initAuthDatabase(testBetterAuth);

  const usageStoreFile = join(tempDir, 'usage.json');
  semanticCache.clear();

  const testSupportStore = createSupportStore(supportStoreFile);
  const testSupportBotService = new TelegramSupportBotService({
    supportStore: testSupportStore,
    botToken: '', // mock mode for fast and isolated test execution
  });

  const testUsageStore = new UsageStore(usageStoreFile);
  const testApiKeyStore = createApiKeyStore(join(tempDir, 'api-keys.json'));
  const testGithubStore = createGithubConnectionStore({
    file: join(tempDir, 'github-connections.json'),
    secret: 'test-github-secret',
  });

  const testAi: AiConfig = { ...FAST_AI, ...ai };
  // Тесты не ходят к настоящим моделям, даже если в .env разработчика есть ключ OpenRouter:
  // шаблонный движок включён явно, а не угадывается по нулевым задержкам.
  const chatGateway = new AIGateway({
    usageStore: extra.usageStore ?? testUsageStore,
    aiConfig: testAi,
    useMockEngine: true,
  });

  // Письма с кодом регистрации и входа перехватываются (их читают signupAndVerify / loginAndVerify),
  // остальные уходят в почтовик теста, если он передан: его счётчики писем не должны меняться.
  const codeMails: MailMessage[] = [];
  const innerMailer = extra.mailer;
  const testMailer: Mailer = {
    kind: innerMailer?.kind ?? 'console',
    async send(message) {
      if (isCodeMail(message)) {
        codeMails.push(message);
        return;
      }
      await innerMailer?.send(message);
    },
  };

  const app = createApp({
    store: createConversationStore(storeFile),
    userStore: createUserStore(userStoreFile),
    subscriptionStore: createSubscriptionStore(subscriptionStoreFile),
    usageStore: testUsageStore,
    apiKeyStore: testApiKeyStore,
    githubConnectionStore: testGithubStore,
    invoiceStore: createInvoiceStore(join(tempDir, 'invoices.json')),
    supportStore: testSupportStore,
    supportBotService: testSupportBotService,
    ai: testAi,
    betterAuth: testBetterAuth,
    chatGateway,
    revokedTokenStore: createRevokedTokenStore(join(tempDir, 'revoked-tokens.json')),
    ...extra,
    mailer: testMailer,
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  rememberCodeMails(baseUrl, codeMails);
  return {
    baseUrl,
    codeMails,
    usageStore: extra.usageStore ?? testUsageStore,
    apiKeyStore: extra.apiKeyStore ?? testApiKeyStore,
    githubConnectionStore: extra.githubConnectionStore ?? testGithubStore,
    close: () =>
      new Promise<void>((resolve, reject) => {
        try {
          testAuthDb.close();
        } catch {
          // ignore
        }
        server.close((error?: Error | null) => (error ? reject(error) : resolve()));
      }),
  };
}

export async function createConversation(baseUrl: string, title: string): Promise<Conversation> {
  const response = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  const body = (await response.json()) as { conversation: Conversation };
  return body.conversation;
}

export async function fetchConversation(
  baseUrl: string,
  id: string,
): Promise<{ conversation: Conversation; messages: Message[] }> {
  const response = await fetch(`${baseUrl}/api/conversations/${id}`);
  return (await response.json()) as { conversation: Conversation; messages: Message[] };
}

export function completionBody(conversationId: string, content = 'привет', extra = {}) {
  return {
    conversationId,
    modelId: DEFAULT_MODEL_ID,
    language: 'ru',
    messages: [{ id: 'message-1', role: 'user', content, createdAt: '2026-09-23T10:00:00.000Z' }],
    ...extra,
  };
}

export async function postCompletion(
  baseUrl: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${baseUrl}/api/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

export interface SseEvent {
  event: string;
  data: string;
}

/** Тело ошибки в едином формате API: `{ error: { code, message } }`. */
export interface ApiErrorBody {
  error: { code: string; message: string };
}

/** Читает JSON-ответ: `Response.json()` в типах Node отдаёт `unknown`. */
export async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** Разбирает поток SSE на события — тот же формат разбирает фронтенд. */
export async function readSseEvents(response: Response): Promise<SseEvent[]> {
  const text = await response.text();
  return text
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice(7) ?? '';
      const data = lines.find((line) => line.startsWith('data: '))?.slice(6) ?? '';
      return { event, data };
    });
}

/** Ждёт, пока условие выполнится: сервер сохраняет ответ асинхронно. */
export async function waitFor<T>(check: () => Promise<T | null>, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result !== null) {
      return result;
    }
    if (Date.now() > deadline) {
      throw new Error(`Не дождались результата за ${timeoutMs} мс`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
