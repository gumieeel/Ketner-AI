import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { DEFAULT_MODEL_ID } from '../ai/models.js';
import { createConversationStore } from '../store/conversation-store.js';
import { createSubscriptionStore } from '../store/subscription-store.js';
import { createUserStore } from '../store/user-store.js';
/** Задержки без пауз: тесты не должны ждать стриминг. */
export const FAST_AI = {
    thinkingMs: [0, 0],
    chunkMs: [0, 0],
    failureRate: 0,
    random: () => 0,
};
/** Поднимает приложение на свободном порту с временным файлом хранилища. */
export async function startTestServer(ai = {}) {
    const tempDir = mkdtempSync(join(tmpdir(), 'ketner-mock-api-'));
    const storeFile = join(tempDir, 'store.json');
    const userStoreFile = join(tempDir, 'users.json');
    const subscriptionStoreFile = join(tempDir, 'subscriptions.json');
    const app = createApp({
        store: createConversationStore(storeFile),
        userStore: createUserStore(userStoreFile),
        subscriptionStore: createSubscriptionStore(subscriptionStoreFile),
        ai: { ...FAST_AI, ...ai },
    });
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        }),
    };
}
export async function createConversation(baseUrl, title) {
    const response = await fetch(`${baseUrl}/api/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
    });
    const body = (await response.json());
    return body.conversation;
}
export async function fetchConversation(baseUrl, id) {
    const response = await fetch(`${baseUrl}/api/conversations/${id}`);
    return (await response.json());
}
export function completionBody(conversationId, content = 'привет', extra = {}) {
    return {
        conversationId,
        modelId: DEFAULT_MODEL_ID,
        language: 'ru',
        messages: [{ id: 'message-1', role: 'user', content, createdAt: '2026-09-23T10:00:00.000Z' }],
        ...extra,
    };
}
export async function postCompletion(baseUrl, body, signal) {
    return fetch(`${baseUrl}/api/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    });
}
/** Читает JSON-ответ: `Response.json()` в типах Node отдаёт `unknown`. */
export async function readJson(response) {
    return (await response.json());
}
/** Разбирает поток SSE на события — тот же формат разбирает фронтенд. */
export async function readSseEvents(response) {
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
export async function waitFor(check, timeoutMs = 3000) {
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
