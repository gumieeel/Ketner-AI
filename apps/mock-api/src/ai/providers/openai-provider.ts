/**
 * Адаптер провайдера OpenAI.
 *
 * Поддерживает Chat Completions API (включая GPT-4o, GPT-4o-mini, o1, o3-mini),
 * SSE streaming, токены рассуждений (reasoning tokens) и отслеживание использования токенов.
 */

import type {
  AIProvider,
  AIProviderType,
  ProviderMessage,
  ProviderRequestOptions,
  ProviderResponse,
  ProviderStreamCallbacks,
} from '../gateway-types.js';

export interface OpenAIProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

export class OpenAIProvider implements AIProvider {
  readonly type: AIProviderType = 'openai';
  readonly name = 'OpenAI';

  private apiKey: string;
  private baseUrl: string;

  constructor(config: OpenAIProviderConfig) {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  private buildPayload(options: ProviderRequestOptions, stream: boolean) {
    const messages = options.messages.map((m: ProviderMessage) => ({
      role: m.role,
      content: m.content,
    }));

    const isReasoningModel = options.model.startsWith('o1') || options.model.startsWith('o3');

    const payload: Record<string, unknown> = {
      model: options.model,
      messages,
      stream,
    };

    if (stream) {
      payload.stream_options = { include_usage: true };
    }

    if (options.maxTokens) {
      if (isReasoningModel) {
        payload.max_completion_tokens = options.maxTokens;
      } else {
        payload.max_tokens = options.maxTokens;
      }
    }

    if (!isReasoningModel && options.temperature !== undefined) {
      payload.temperature = options.temperature;
    }

    return payload;
  }

  async generateText(options: ProviderRequestOptions): Promise<ProviderResponse> {
    const payload = this.buildPayload(options, false);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: options.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`OpenAI API error [${response.status}]: ${errText}`);
    }

    const json = (await response.json()) as {
      choices: Array<{ message: { content?: string }; finish_reason?: string }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };

    const choice = json.choices?.[0];
    const content = choice?.message?.content ?? '';
    const finishReason = choice?.finish_reason === 'length' ? 'length' : 'stop';

    return {
      content,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? Math.ceil(content.length / 4),
        outputTokens: json.usage?.completion_tokens ?? Math.ceil(content.length / 4),
        cachedTokens: json.usage?.prompt_tokens_details?.cached_tokens,
        reasoningTokens: json.usage?.completion_tokens_details?.reasoning_tokens,
      },
      finishReason,
    };
  }

  async streamText(
    options: ProviderRequestOptions,
    callbacks: ProviderStreamCallbacks,
  ): Promise<ProviderResponse> {
    const payload = this.buildPayload(options, true);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: options.signal,
    });

    if (!response.ok || !response.body) {
      const errText = await response.text().catch(() => '');
      throw new Error(`OpenAI Streaming API error [${response.status}]: ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulatedContent = '';
    let finalUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: undefined as number | undefined,
      reasoningTokens: undefined as number | undefined,
    };
    let finishReason: 'stop' | 'length' | 'cancelled' | 'error' = 'stop';

    try {
      while (true) {
        if (callbacks.isCancelled()) {
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
          finishReason = 'cancelled';
          break;
        }

        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(dataStr);
            const delta =
              parsed.choices?.[0]?.delta?.content ??
              parsed.choices?.[0]?.delta?.reasoning_content ??
              '';

            if (delta) {
              accumulatedContent += delta;
              callbacks.onDelta(delta);
            }

            if (parsed.choices?.[0]?.finish_reason === 'length') {
              finishReason = 'length';
            }

            if (parsed.usage) {
              finalUsage = {
                inputTokens: parsed.usage.prompt_tokens ?? finalUsage.inputTokens,
                outputTokens: parsed.usage.completion_tokens ?? finalUsage.outputTokens,
                cachedTokens: parsed.usage.prompt_tokens_details?.cached_tokens,
                reasoningTokens: parsed.usage.completion_tokens_details?.reasoning_tokens,
              };
            }
          } catch {
            // ignore chunk parse errors
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError' || callbacks.isCancelled()) {
        finishReason = 'cancelled';
      } else {
        throw err;
      }
    }

    if (finalUsage.outputTokens === 0 && accumulatedContent.length > 0) {
      finalUsage.outputTokens = Math.ceil(accumulatedContent.length / 4);
    }

    return {
      content: accumulatedContent,
      usage: finalUsage,
      finishReason,
    };
  }
}
