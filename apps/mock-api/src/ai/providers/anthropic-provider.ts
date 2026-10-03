/**
 * Адаптер провайдера Anthropic Claude.
 *
 * Поддерживает Messages API (Claude 3.5 Sonnet, Claude 3 Opus, Claude 3.5 Haiku),
 * SSE streaming, кэширование промптов (prompt caching) и учёт токенов.
 */

import type {
  AIProvider,
  AIProviderType,
  ProviderRequestOptions,
  ProviderResponse,
  ProviderStreamCallbacks,
} from '../gateway-types.js';

export interface AnthropicProviderConfig {
  apiKey: string;
  baseUrl?: string;
  apiVersion?: string;
}

export class AnthropicProvider implements AIProvider {
  readonly type: AIProviderType = 'anthropic';
  readonly name = 'Anthropic';

  private apiKey: string;
  private baseUrl: string;
  private apiVersion: string;

  constructor(config: AnthropicProviderConfig) {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    this.apiVersion = config.apiVersion ?? '2023-06-01';
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  private buildPayload(options: ProviderRequestOptions, stream: boolean) {
    let systemPrompt: string | undefined = options.systemPrompt;
    const messages: Array<{ role: 'user' | 'assistant'; content: string | any[] }> = [];

    for (const msg of options.messages) {
      if (msg.role === 'system') {
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${msg.content}` : msg.content;
      } else {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    if (messages.length === 0) {
      messages.push({ role: 'user', content: 'Hello' });
    }

    const payload: Record<string, unknown> = {
      model: options.model,
      messages,
      max_tokens: options.maxTokens ?? 4096,
      stream,
    };

    if (systemPrompt) {
      // Phase 3: Prompt caching для системного промпта
      payload.system = [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ];
    }

    // Phase 3: Prompt caching для стабильной части истории (сообщение перед последним вопросом)
    if (messages.length > 2) {
      const checkpointIndex = messages.length - 2;
      const target = messages[checkpointIndex];
      if (target && typeof target.content === 'string') {
        (messages as any)[checkpointIndex] = {
          role: target.role,
          content: [
            {
              type: 'text',
              text: target.content,
              cache_control: { type: 'ephemeral' },
            },
          ],
        };
      }
    }

    if (options.temperature !== undefined) {
      payload.temperature = options.temperature;
    }

    return payload;
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': this.apiVersion,
      'anthropic-beta': 'prompt-caching-2024-07-31',
    };
  }

  async generateText(options: ProviderRequestOptions): Promise<ProviderResponse> {
    const payload = this.buildPayload(options, false);

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
      signal: options.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Anthropic API error [${response.status}]: ${errText}`);
    }

    const json = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
      };
      stop_reason?: string;
    };

    const textBlocks = json.content?.filter((c) => c.type === 'text') ?? [];
    const content = textBlocks.map((b) => b.text ?? '').join('');
    const finishReason = json.stop_reason === 'max_tokens' ? 'length' : 'stop';
    const cachedTokens = json.usage?.cache_read_input_tokens;
    const baseInputTokens = json.usage?.input_tokens ?? Math.ceil(content.length / 4);

    return {
      content,
      usage: {
        inputTokens: baseInputTokens + (cachedTokens ?? 0),
        outputTokens: json.usage?.output_tokens ?? Math.ceil(content.length / 4),
        cachedTokens: cachedTokens && cachedTokens > 0 ? cachedTokens : undefined,
      },
      finishReason,
    };
  }

  async streamText(
    options: ProviderRequestOptions,
    callbacks: ProviderStreamCallbacks,
  ): Promise<ProviderResponse> {
    const payload = this.buildPayload(options, true);

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
      signal: options.signal,
    });

    if (!response.ok || !response.body) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Anthropic Streaming API error [${response.status}]: ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulatedContent = '';
    const finalUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: undefined as number | undefined,
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

          try {
            const parsed = JSON.parse(dataStr);
            const type = parsed.type;

            if (type === 'message_start' && parsed.message?.usage) {
              const cached = parsed.message.usage.cache_read_input_tokens ?? 0;
              finalUsage.inputTokens = (parsed.message.usage.input_tokens ?? 0) + cached;
              finalUsage.cachedTokens = cached > 0 ? cached : undefined;
            } else if (type === 'content_block_delta' && parsed.delta?.text) {
              const delta = parsed.delta.text;
              accumulatedContent += delta;
              callbacks.onDelta(delta);
            } else if (type === 'message_delta') {
              if (parsed.usage?.output_tokens) {
                finalUsage.outputTokens = parsed.usage.output_tokens;
              }
              if (parsed.delta?.stop_reason === 'max_tokens') {
                finishReason = 'length';
              }
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
