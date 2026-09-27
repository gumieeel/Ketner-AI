/**
 * Адаптер провайдера OpenRouter.
 *
 * Интегрирует OpenRouter API с поддержкой OpenAI-совместимого формата,
 * пула бесплатных fallback-моделей и потоковой генерации.
 */
const DEFAULT_CANDIDATES = [
    'openai/gpt-4o-mini',
    'deepseek/deepseek-chat',
    'qwen/qwen3.8-27b:free',
    'openrouter/free',
];
export class OpenRouterProvider {
    type = 'openrouter';
    name = 'OpenRouter';
    apiKey;
    baseUrl;
    defaultModel;
    constructor(config) {
        this.apiKey = config.apiKey.trim();
        this.baseUrl = (config.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
        this.defaultModel = config.defaultModel ?? 'nvidia/nemotron-3-ultra-550b-a55b:free';
    }
    isAvailable() {
        return this.apiKey.length > 0;
    }
    getCandidateModels(requestedModel) {
        const list = [];
        if (requestedModel && requestedModel.trim()) {
            const clean = requestedModel.trim();
            list.push(clean);
            if (clean.includes('gpt-6-sol')) {
                list.push('openai/gpt-6-luna-pro', 'openai/gpt-4o');
            }
            else if (clean.includes('gpt-6-luna')) {
                list.push('openai/gpt-4o-mini', 'deepseek/deepseek-chat');
            }
            else if (clean.includes('claude-opus')) {
                list.push('anthropic/claude-fable-5.1', 'anthropic/claude-3.5-sonnet');
            }
        }
        else if (this.defaultModel) {
            list.push(this.defaultModel);
        }
        for (const c of DEFAULT_CANDIDATES) {
            if (!list.includes(c))
                list.push(c);
        }
        return list;
    }
    async generateText(options) {
        const modelsToTry = this.getCandidateModels(options.model);
        const messages = options.messages.map((m) => ({
            role: m.role,
            content: m.content,
        }));
        for (const targetModel of modelsToTry) {
            try {
                const response = await fetch(`${this.baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://ketner.ai',
                        'X-Title': 'Ketner AI',
                    },
                    body: JSON.stringify({
                        model: targetModel,
                        messages,
                        stream: false,
                        max_tokens: Math.min(options.maxTokens ?? 2048, 2048),
                    }),
                    signal: options.signal,
                });
                if (!response.ok)
                    continue;
                const json = (await response.json());
                const content = json.choices?.[0]?.message?.content ?? '';
                return {
                    content,
                    usage: {
                        inputTokens: json.usage?.prompt_tokens ?? Math.ceil(content.length / 4),
                        outputTokens: json.usage?.completion_tokens ?? Math.ceil(content.length / 4),
                    },
                    finishReason: json.choices?.[0]?.finish_reason === 'length' ? 'length' : 'stop',
                };
            }
            catch (err) {
                if (err?.name === 'AbortError') {
                    return {
                        content: '',
                        usage: { inputTokens: 0, outputTokens: 0 },
                        finishReason: 'cancelled',
                    };
                }
            }
        }
        throw new Error('All OpenRouter candidate models failed');
    }
    async streamText(options, callbacks) {
        const modelsToTry = this.getCandidateModels(options.model);
        const messages = options.messages.map((m) => ({
            role: m.role,
            content: m.content,
        }));
        for (const targetModel of modelsToTry) {
            if (callbacks.isCancelled()) {
                return {
                    content: '',
                    usage: { inputTokens: 0, outputTokens: 0 },
                    finishReason: 'cancelled',
                };
            }
            try {
                const response = await fetch(`${this.baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://ketner.ai',
                        'X-Title': 'Ketner AI',
                    },
                    body: JSON.stringify({
                        model: targetModel,
                        messages,
                        stream: true,
                        max_tokens: Math.min(options.maxTokens ?? 2048, 2048),
                    }),
                    signal: options.signal,
                });
                if (!response.ok || !response.body)
                    continue;
                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let buffer = '';
                let accumulatedContent = '';
                let streamedAny = false;
                let finishReason = 'stop';
                let promptTokens = 0;
                let completionTokens = 0;
                let reasoningTokens = null;
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
                        if (dataStr === '[DONE]')
                            continue;
                        try {
                            const parsed = JSON.parse(dataStr);
                            const delta = parsed.choices?.[0]?.delta?.content ??
                                parsed.choices?.[0]?.delta?.reasoning ??
                                '';
                            if (delta) {
                                streamedAny = true;
                                accumulatedContent += delta;
                                callbacks.onDelta(delta);
                            }
                            if (parsed.choices?.[0]?.finish_reason === 'length') {
                                finishReason = 'length';
                            }
                            if (parsed.usage) {
                                promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
                                completionTokens = parsed.usage.completion_tokens ?? completionTokens;
                                const rTokens = parsed.usage.completion_tokens_details?.reasoning_tokens ??
                                    parsed.usage.completionTokensDetails?.reasoningTokens;
                                if (typeof rTokens === 'number') {
                                    reasoningTokens = rTokens;
                                }
                            }
                        }
                        catch {
                            // ignore parsing errors
                        }
                    }
                }
                if (streamedAny) {
                    if (completionTokens === 0) {
                        completionTokens = Math.ceil(accumulatedContent.length / 4);
                    }
                    return {
                        content: accumulatedContent,
                        usage: {
                            inputTokens: promptTokens,
                            outputTokens: completionTokens,
                            reasoningTokens: reasoningTokens ?? undefined,
                        },
                        finishReason,
                    };
                }
            }
            catch (err) {
                if (err?.name === 'AbortError' || callbacks.isCancelled()) {
                    return {
                        content: '',
                        usage: { inputTokens: 0, outputTokens: 0 },
                        finishReason: 'cancelled',
                    };
                }
            }
        }
        throw new Error('All OpenRouter streaming candidate models failed');
    }
    /**
     * OpenRouter Batch API (POST /api/v1/batches):
     * Отправка пакета задач для фоновой обработки со скидкой до 50%
     */
    async createBatch(model, requests) {
        const response = await fetch(`${this.baseUrl}/batches`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://ketner.ai',
                'X-Title': 'Ketner AI',
            },
            body: JSON.stringify({
                endpoint: '/v1/chat/completions',
                model,
                requests: requests.map((r) => ({
                    custom_id: r.customId,
                    body: {
                        model,
                        messages: r.messages,
                        max_tokens: r.maxTokens ?? 2048,
                    },
                })),
            }),
        });
        if (!response.ok) {
            const err = await response.text();
            throw new Error(`OpenRouter Batch creation failed (${response.status}): ${err}`);
        }
        const data = (await response.json());
        return { id: data.id, status: data.status, raw: data };
    }
    /**
     * OpenRouter Batch API (GET /api/v1/batches/:id):
     * Проверка состояния пакета и получение завершённых результатов
     */
    async getBatch(batchId) {
        const response = await fetch(`${this.baseUrl}/batches/${batchId}`, {
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            const err = await response.text();
            throw new Error(`OpenRouter Batch query failed (${response.status}): ${err}`);
        }
        const data = (await response.json());
        return { id: data.id, status: data.status, results: data.results, raw: data };
    }
}
