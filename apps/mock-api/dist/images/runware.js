/**
 * Runware: платные модели картинок (FLUX.2 dev и pro, Seedream, Nano Banana) через один API.
 * Запрос — массив задач `imageInference`, ответ `{data: [{imageBase64Data, cost}]}`; ошибки приходят
 * в `errors` (например, insufficientCredits, когда на балансе Runware кончились деньги).
 * Стоимость берётся из ответа (`includeCost`), поэтому в учёт попадает реальная цена картинки.
 */
import { randomUUID } from 'node:crypto';
import { ImageProviderError } from './cloudflare.js';
const ENDPOINT = 'https://api.runware.ai/v1';
export function createRunwareGenerator(options) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const available = Boolean(options.apiKey);
    return {
        available,
        supports: (model) => available && model.provider === 'runware',
        async generate({ model, prompt, width, height, signal }) {
            if (!available)
                throw new ImageProviderError('Runware is not configured', 503);
            const task = {
                taskType: 'imageInference',
                taskUUID: randomUUID(),
                positivePrompt: prompt,
                model: model.engine,
                width,
                height,
                numberResults: 1,
                outputType: 'base64Data',
                outputFormat: 'JPG',
                includeCost: true,
            };
            const timeout = AbortSignal.timeout(options.timeoutMs ?? 120_000);
            const response = await fetchImpl(ENDPOINT, {
                method: 'POST',
                headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify([task]),
                signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
            });
            const text = await response.text();
            let body = {};
            try {
                body = JSON.parse(text);
            }
            catch {
                // не JSON — ниже это станет ошибкой провайдера
            }
            const error = body.errors?.[0];
            if (!response.ok || error) {
                const code = error?.code ?? `HTTP ${response.status}`;
                throw new ImageProviderError(`Runware ${code}: ${(error?.message ?? text).slice(0, 300)}`, response.ok ? 502 : response.status);
            }
            const item = body.data?.[0];
            const image = item?.imageBase64Data;
            if (typeof image !== 'string' || image.length < 100) {
                throw new ImageProviderError('Runware returned no image', 502);
            }
            const bytes = Buffer.from(image, 'base64');
            const mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : bytes[0] === 0x52 && bytes[1] === 0x49 ? 'image/webp' : 'image/jpeg';
            const cost = typeof item?.cost === 'number' && Number.isFinite(item.cost) && item.cost >= 0 ? item.cost : undefined;
            return { bytes, mime, costUsd: cost };
        },
    };
}
/** Один генератор поверх нескольких провайдеров: модель уходит тому, кто её поддерживает. */
export function combineGenerators(...generators) {
    const supporting = (model) => generators.find((g) => (g.supports ? g.supports(model) : g.available));
    return {
        available: generators.some((g) => g.available),
        supports: (model) => Boolean(supporting(model)),
        async generate(input) {
            const generator = supporting(input.model);
            if (!generator)
                throw new ImageProviderError(`No provider for ${input.model.id}`, 503);
            return generator.generate(input);
        },
    };
}
