import type { IncomingMessage } from '../types.js';

export interface StreamOpenRouterOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  messages: IncomingMessage[];
  systemPrompt?: string;
  isCancelled: () => boolean;
  onDelta: (chunk: string) => void;
  maxTokens?: number;
}

const DEFAULT_CANDIDATE_MODELS = [
  'nex-agi/nex-n2.5-mini:free',
  'nex-agi/nex-n2.5-pro:free',
  'qwen/qwen3.8-27b:free',
  'google/gemma-4-26b-a4b-it:free',
  'openrouter/free',
];

/**
 * Выполняет реальный потоковый запрос к OpenRouter API.
 * В случае сбоя или лимитов одной модели пробует следующую из списка бесплатных.
 * Возвращает true, если ответ был успешно сгенерирован и передан через onDelta.
 */
export async function streamOpenRouter(options: StreamOpenRouterOptions): Promise<boolean> {
  const { apiKey, baseUrl = 'https://openrouter.ai/api/v1', model } = options;

  if (!apiKey || apiKey.trim() === '') {
    return false;
  }

  const systemMessage = options.systemPrompt
    ? [{ role: 'system', content: options.systemPrompt }]
    : [
        {
          role: 'system',
          content:
            'Ты — умный, дружелюбный и профессиональный инженерный ИИ-ассистент Ketner AI на базе Qwen. ' +
            'Отвечай конкретно, по делу, с чистым форматированием Markdown, блоками кода и пошаговыми инструкциями на русском языке.',
        },
      ];

  const payloadMessages = [
    ...systemMessage,
    ...options.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  ];

  const modelsToTry: string[] = [];
  if (model && model.trim()) {
    modelsToTry.push(model.trim());
  }
  for (const candidate of DEFAULT_CANDIDATE_MODELS) {
    if (!modelsToTry.includes(candidate)) {
      modelsToTry.push(candidate);
    }
  }

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  for (const targetModel of modelsToTry) {
    if (options.isCancelled()) {
      return false;
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://ketner.ai',
          'X-Title': 'Ketner AI',
        },
        body: JSON.stringify({
          model: targetModel,
          messages: payloadMessages,
          stream: true,
          max_tokens: options.maxTokens ?? 4096,
        }),
      });

      if (!response.ok || !response.body) {
        console.warn(`[openrouter] модель ${targetModel} ответила со статусом ${response.status}`);
        continue;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let streamedAny = false;

      while (true) {
        if (options.isCancelled()) {
          try {
            await reader.cancel();
          } catch {
            // Игнорируем
          }
          return false;
        }

        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) {
            continue;
          }
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') {
            continue;
          }

          try {
            const parsed = JSON.parse(dataStr);
            const delta =
              parsed.choices?.[0]?.delta?.content ??
              parsed.choices?.[0]?.delta?.reasoning ??
              '';
            if (delta) {
              streamedAny = true;
              options.onDelta(delta);
            }
          } catch {
            // Игнорируем ошибки парсинга неполных чанков
          }
        }
      }

      if (streamedAny) {
        return true;
      }
    } catch (error) {
      console.warn(`[openrouter] ошибка запроса к модели ${targetModel}:`, error);
    }
  }

  return false;
}
