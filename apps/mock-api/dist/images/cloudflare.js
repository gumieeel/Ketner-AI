/**
 * Cloudflare Workers AI: генерация картинок FLUX. Ответ — JPEG в base64 (`result.image`).
 * FLUX.1 schnell принимает JSON и всегда отдаёт 1024×1024; FLUX.2 — multipart с размером.
 */
export class ImageProviderError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
export function createCloudflareGenerator(options) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const available = Boolean(options.accountId && options.apiToken);
    return {
        available,
        async generate({ model, prompt, width, height, signal }) {
            if (!available)
                throw new ImageProviderError('Cloudflare Workers AI is not configured', 503);
            const url = `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/ai/run/${model.engine}`;
            const headers = { Authorization: `Bearer ${options.apiToken}` };
            let body;
            if (model.request === 'json') {
                headers['Content-Type'] = 'application/json';
                body = JSON.stringify({ prompt, steps: 4 });
            }
            else {
                const form = new FormData();
                form.set('prompt', prompt);
                form.set('width', String(width));
                form.set('height', String(height));
                body = form;
            }
            const timeout = AbortSignal.timeout(options.timeoutMs ?? 90_000);
            const response = await fetchImpl(url, {
                method: 'POST',
                headers,
                body,
                signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
            });
            const text = await response.text();
            if (!response.ok) {
                throw new ImageProviderError(`Workers AI HTTP ${response.status}: ${text.slice(0, 300)}`, response.status);
            }
            let image;
            try {
                image = JSON.parse(text).result?.image;
            }
            catch {
                image = undefined;
            }
            if (typeof image !== 'string' || image.length < 100) {
                throw new ImageProviderError('Workers AI returned no image', 502);
            }
            const bytes = Buffer.from(image, 'base64');
            const mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : 'image/jpeg';
            return { bytes, mime };
        },
    };
}
