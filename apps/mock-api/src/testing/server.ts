import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import type { AiConfig } from '../config.js';
import { DEFAULT_MODEL_ID } from '../ai/models.js';
import { createConversationStore } from '../store/conversation-store.js';
import { createUserStore } from '../store/user-store.js';
import type { Conversation, Message } from '../types.js';

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
}

/** Поднимает приложение на свободном порту с временным файлом хранилища. */
export async function startTestServer(ai: Partial<AiConfig> = {}): Promise<TestServer> {
  const tempDir = mkdtempSync(join(tmpdir(), 'ketner-mock-api-'));
  const storeFile = join(tempDir, 'store.json');
  const userStoreFile = join(tempDir, 'users.json');
  const app = createApp({
    store: createConversationStore(storeFile),
    userStore: createUserStore(userStoreFile),
    ai: { ...FAST_AI, ...ai },
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
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
