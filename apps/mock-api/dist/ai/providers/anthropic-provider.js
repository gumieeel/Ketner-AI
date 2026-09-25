/**
 * Адаптер провайдера Anthropic Claude.
 *
 * Поддерживает Messages API (Claude 3.5 Sonnet, Claude 3 Opus, Claude 3.5 Haiku),
 * SSE streaming, кэширование промптов (prompt caching) и учёт токенов.
 */
export class AnthropicProvider {
    type = 'anthropic';
    name = 'Anthropic';
    apiKey;
    baseUrl;
    apiVersion;
    constructor(config) {
        this.apiKey = config.apiKey.trim();
        this.baseUrl = (config.baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/+$/, '');
        this.apiVersion = config.apiVersion ?? '2023-06-01';
    }
    isAvailable() {
        return this.apiKey.length > 0;
    }
    buildPayload(options, stream) {
        let systemPrompt;
        const messages = [];
        for (const msg of options.messages) {
            if (msg.role === 'system') {
                systemPrompt = systemPrompt ? `${systemPrompt}\n\n${msg.content}` : msg.content;
            }
            else {
                messages.push({
                    role: msg.role,
                    content: msg.content,
                });
            }
        }
        if (messages.length === 0) {
            messages.push({ role: 'user', content: 'Hello' });
        }
        const payload = {
            model: options.model,
            messages,
            max_tokens: options.maxTokens ?? 4096,
            stream,
        };
        if (systemPrompt) {
            payload.system = systemPrompt;
        }
        if (options.temperature !== undefined) {
            payload.temperature = options.temperature;
        }
        return payload;
    }
    getHeaders() {
        return {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': this.apiVersion,
        };
    }
    async generateText(options) {
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
        const json = (await response.json());
        const textBlocks = json.content?.filter((c) => c.type === 'text') ?? [];
        const content = textBlocks.map((b) => b.text ?? '').join('');
        const finishReason = json.stop_reason === 'max_tokens' ? 'length' : 'stop';
        return {
            content,
            usage: {
                inputTokens: json.usage?.input_tokens ?? Math.ceil(content.length / 4),
                outputTokens: json.usage?.output_tokens ?? Math.ceil(content.length / 4),
                cachedTokens: json.usage?.cache_read_input_tokens,
            },
            finishReason,
        };
    }
    async streamText(options, callbacks) {
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
        let finalUsage = {
            inputTokens: 0,
            outputTokens: 0,
            cachedTokens: undefined,
        };
        let finishReason = 'stop';
        try {
            while (true) {
                if (callbacks.isCancelled()) {
                    try {
                        await reader.cancel();
                    }
                    catch {
                        // ignore
                    }
                    finishReason = 'cancelled';
                    break;
                }
                const { value, done } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data:'))
                        continue;
                    const dataStr = trimmed.slice(5).trim();
                    try {
                        const parsed = JSON.parse(dataStr);
                        const type = parsed.type;
                        if (type === 'message_start' && parsed.message?.usage) {
                            finalUsage.inputTokens = parsed.message.usage.input_tokens ?? 0;
                            finalUsage.cachedTokens = parsed.message.usage.cache_read_input_tokens;
                        }
                        else if (type === 'content_block_delta' && parsed.delta?.text) {
                            const delta = parsed.delta.text;
                            accumulatedContent += delta;
                            callbacks.onDelta(delta);
                        }
                        else if (type === 'message_delta') {
                            if (parsed.usage?.output_tokens) {
                                finalUsage.outputTokens = parsed.usage.output_tokens;
                            }
                            if (parsed.delta?.stop_reason === 'max_tokens') {
                                finishReason = 'length';
                            }
                        }
                    }
                    catch {
                        // ignore chunk parse errors
                    }
                }
            }
        }
        catch (err) {
            if (err?.name === 'AbortError' || callbacks.isCancelled()) {
                finishReason = 'cancelled';
            }
            else {
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
