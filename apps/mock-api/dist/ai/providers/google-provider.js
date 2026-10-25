/**
 * Адаптер провайдера Google Gemini.
 *
 * Поддерживает Gemini API (Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 1.5 Pro),
 * SSE streaming через alt=sse, кэширование контекста и подсчёт токенов (usageMetadata).
 */
export class GoogleProvider {
    type = 'google';
    name = 'Google Gemini';
    apiKey;
    baseUrl;
    constructor(config) {
        this.apiKey = config.apiKey.trim();
        this.baseUrl = (config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    }
    isAvailable() {
        return this.apiKey.length > 0;
    }
    buildPayload(options) {
        let systemInstruction;
        const contents = [];
        for (const msg of options.messages) {
            if (msg.role === 'system') {
                systemInstruction = {
                    parts: [{ text: msg.content }],
                };
            }
            else {
                contents.push({
                    role: msg.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: msg.content }],
                });
            }
        }
        if (contents.length === 0) {
            contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
        }
        const payload = { contents };
        if (systemInstruction) {
            payload.systemInstruction = systemInstruction;
        }
        const generationConfig = {};
        if (options.maxTokens) {
            generationConfig.maxOutputTokens = options.maxTokens;
        }
        if (options.temperature !== undefined) {
            generationConfig.temperature = options.temperature;
        }
        if (Object.keys(generationConfig).length > 0) {
            payload.generationConfig = generationConfig;
        }
        return payload;
    }
    async generateText(options) {
        const payload = this.buildPayload(options);
        const model = options.model.replace(/^models\//, '');
        const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: options.signal,
        });
        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`Google Gemini API error [${response.status}]: ${errText}`);
        }
        const json = (await response.json());
        const candidate = json.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];
        const content = parts.map((p) => p.text ?? '').join('');
        const finishReason = candidate?.finishReason === 'MAX_TOKENS' ? 'length' : 'stop';
        return {
            content,
            usage: {
                inputTokens: json.usageMetadata?.promptTokenCount ?? Math.ceil(content.length / 4),
                outputTokens: json.usageMetadata?.candidatesTokenCount ?? Math.ceil(content.length / 4),
                cachedTokens: json.usageMetadata?.cachedContentTokenCount,
            },
            finishReason,
        };
    }
    async streamText(options, callbacks) {
        const payload = this.buildPayload(options);
        const model = options.model.replace(/^models\//, '');
        const url = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: options.signal,
        });
        if (!response.ok || !response.body) {
            const errText = await response.text().catch(() => '');
            throw new Error(`Google Gemini Streaming API error [${response.status}]: ${errText}`);
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
                        const candidate = parsed.candidates?.[0];
                        const parts = candidate?.content?.parts ?? [];
                        for (const part of parts) {
                            if (part.text) {
                                accumulatedContent += part.text;
                                callbacks.onDelta(part.text);
                            }
                        }
                        if (candidate?.finishReason === 'MAX_TOKENS') {
                            finishReason = 'length';
                        }
                        if (parsed.usageMetadata) {
                            finalUsage = {
                                inputTokens: parsed.usageMetadata.promptTokenCount ?? finalUsage.inputTokens,
                                outputTokens: parsed.usageMetadata.candidatesTokenCount ?? finalUsage.outputTokens,
                                cachedTokens: parsed.usageMetadata.cachedContentTokenCount,
                            };
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
