import Anthropic from '@anthropic-ai/sdk';
import { eq, asc } from 'drizzle-orm';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { config } from '../config.js';

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    if (!config.anthropicApiKey || config.anthropicApiKey.trim() === '') {
      throw new Error('ANTHROPIC_API_KEY не установлен. Пожалуйста, укажите ключ в .env');
    }
    anthropicClient = new Anthropic({
      apiKey: config.anthropicApiKey,
      baseURL: config.anthropicBaseUrl || undefined,
    });
  }
  return anthropicClient;
}

export function isAnthropicAvailable(): boolean {
  return Boolean(config.anthropicApiKey && config.anthropicApiKey.trim().length > 0);
}

/**
 * Генерация разового ответа через официальный Claude Messages API.
 */
export async function generateChatResponse(
  conversationId: string,
  userMessage: string,
  model: string = 'claude-3-5-sonnet-20241022',
): Promise<string> {
  const anthropic = getAnthropicClient();

  // 1. Получаем историю сообщений из БД (если доступна)
  let messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  if (config.databaseUrl) {
    try {
      const history = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conversationId))
        .orderBy(asc(schema.messages.createdAt));

      messages = history.map((m: any) => ({
        role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: m.content,
      }));
    } catch (err) {
      console.warn('[AI Service] Не удалось загрузить историю из БД:', err);
    }
  }

  messages.push({ role: 'user', content: userMessage });

  // 2. Запрос к Claude API
  const response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: 'You are a helpful AI assistant. Answer in the same language as the user.',
    messages,
  });

  const firstBlock = response.content[0];
  if (!firstBlock || firstBlock.type !== 'text') {
    throw new Error('Неожиданный формат ответа Claude API');
  }

  const assistantText = firstBlock.text;

  // 3. Сохранение сообщения и расчёт стоимости
  if (config.databaseUrl) {
    try {
      const usage = response.usage;
      const inputTokens = usage.input_tokens ?? 0;
      const outputTokens = usage.output_tokens ?? 0;
      // Claude 3.5 Sonnet: $3 / 1M input, $15 / 1M output
      const costUsd = ((inputTokens * 3 + outputTokens * 15) / 1_000_000).toFixed(6);

      await db.insert(schema.messages).values({
        conversationId,
        role: 'assistant',
        content: assistantText,
        model,
        tokensUsed: outputTokens,
        tokensInput: inputTokens,
        tokensOutput: outputTokens,
        costUsd,
      });
    } catch (err) {
      console.warn('[AI Service] Ошибка записи ответа в БД:', err);
    }
  }

  return assistantText;
}

/**
 * Потоковая генерация ответа (SSE Streaming) через Claude Messages API.
 */
export async function streamChatResponse(
  conversationId: string,
  userMessage: string,
  onChunk: (chunk: string) => void,
  model: string = 'claude-3-5-sonnet-20241022',
  signal?: AbortSignal,
): Promise<string> {
  const anthropic = getAnthropicClient();

  // 1. Получаем историю
  let messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  if (config.databaseUrl) {
    try {
      const history = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conversationId))
        .orderBy(asc(schema.messages.createdAt));

      messages = history.map((m: any) => ({
        role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: m.content,
      }));
    } catch (err) {
      console.warn('[AI Service] Не удалось прочитать историю из БД:', err);
    }
  }

  messages.push({ role: 'user', content: userMessage });

  // 2. Стриминг ответа от Claude
  const stream = await anthropic.messages.stream(
    {
      model,
      max_tokens: 4096,
      system: 'You are a helpful AI assistant. Answer in the same language as the user.',
      messages,
    },
    { signal },
  );

  let fullMessage = '';

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      const text = event.delta.text;
      fullMessage += text;
      onChunk(text);
    }
  }

  // 3. Сохранение и учёт токенов
  if (config.databaseUrl) {
    try {
      const finalMessage = await stream.finalMessage();
      const usage = finalMessage.usage;
      const inputTokens = usage.input_tokens ?? 0;
      const outputTokens = usage.output_tokens ?? 0;
      const costUsd = ((inputTokens * 3 + outputTokens * 15) / 1_000_000).toFixed(6);

      await db.insert(schema.messages).values({
        conversationId,
        role: 'assistant',
        content: fullMessage,
        model,
        tokensUsed: outputTokens,
        tokensInput: inputTokens,
        tokensOutput: outputTokens,
        costUsd,
      });
    } catch (err) {
      console.warn('[AI Service] Ошибка записи стрим-сообщения в БД:', err);
    }
  }

  return fullMessage;
}
