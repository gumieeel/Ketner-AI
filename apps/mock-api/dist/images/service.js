/**
 * Генерация картинок: тариф, суточные лимиты с запасной моделью, месячный бюджет, проверка запроса,
 * генерация, сохранение и учёт расхода (в тот же бюджет тарифа, что и чат).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { evaluateBudget } from '../services/budget-policy.js';
import { EntitlementService } from '../services/entitlement.js';
import { ASPECT_SIZES, DEFAULT_IMAGE_MODEL_ID, IMAGE_MODELS, getImageModel, imageCostUsd, imageDailyLimit, } from './models.js';
export const MAX_PROMPT_CHARS = 1_000;
const URL_TTL_SECONDS = 6 * 60 * 60;
export class ImageServiceError extends Error {
    code;
    status;
    constructor(code, status, message) {
        super(message);
        this.code = code;
        this.status = status;
    }
}
const t = (language, ru, en) => (language === 'en' ? en : ru);
const BLOCK_MESSAGES = {
    minors: {
        ru: 'Запрос нарушает правила: изображения сексуального характера с участием несовершеннолетних запрещены.',
        en: 'This request violates the rules: sexual imagery involving minors is prohibited.',
    },
    sexual: { ru: 'Откровенные и сексуальные изображения создавать нельзя.', en: 'Explicit or sexual images cannot be generated.' },
    real_person: {
        ru: 'Нельзя создавать унизительные, сексуальные или поддельные изображения реальных людей.',
        en: 'Humiliating, sexual or fake images of real people cannot be generated.',
    },
    violence: { ru: 'Изображения с жестоким насилием создавать нельзя.', en: 'Graphic violence cannot be generated.' },
    hate: { ru: 'Изображения с символикой ненависти создавать нельзя.', en: 'Hateful imagery cannot be generated.' },
    other: { ru: 'Такое изображение создать нельзя: запрос нарушает правила сервиса.', en: 'This image cannot be generated: the request violates the service rules.' },
};
export class ImageService {
    deps;
    inFlight = new Set();
    constructor(deps) {
        this.deps = deps;
    }
    get available() {
        return this.deps.generator.available;
    }
    capabilities(caller) {
        return {
            available: this.available,
            defaultModelId: DEFAULT_IMAGE_MODEL_ID,
            maxPromptChars: MAX_PROMPT_CHARS,
            models: IMAGE_MODELS.map((model) => {
                const dailyLimit = imageDailyLimit(model, caller.plan);
                return {
                    id: model.id,
                    name: model.name,
                    aspects: model.aspects,
                    requiredPlan: model.requiredPlan,
                    locked: dailyLimit === 0,
                    dailyLimit,
                    usedToday: this.deps.usageStore.getImagesLastDay(caller.userId, model.id),
                };
            }),
        };
    }
    sign(id, exp) {
        return createHmac('sha256', this.deps.urlSecret).update(`image:${id}:${exp}`).digest('base64url');
    }
    /** Подпись ссылки на файл: картинки открываются в <img> и скачиваются без заголовка авторизации. */
    verify(id, exp, sig) {
        if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000))
            return false;
        const expected = Buffer.from(this.sign(id, exp));
        const given = Buffer.from(sig);
        return expected.length === given.length && timingSafeEqual(expected, given);
    }
    toPublic(meta, base = '/api/images') {
        const exp = Math.floor(Date.now() / 1000) + URL_TTL_SECONDS;
        const query = `exp=${exp}&sig=${this.sign(meta.id, exp)}`;
        return {
            id: meta.id,
            prompt: meta.prompt,
            modelId: meta.modelId,
            modelName: getImageModel(meta.modelId)?.name ?? meta.modelId,
            width: meta.width,
            height: meta.height,
            createdAt: meta.createdAt,
            url: `${base}/${meta.id}/file?${query}`,
            downloadUrl: `${base}/${meta.id}/file?${query}&download=1`,
        };
    }
    async list(caller) {
        return (await this.deps.store.list(caller.userId)).map((meta) => this.toPublic(meta));
    }
    async generate(caller, input, signal) {
        const { language } = caller;
        if (!this.available) {
            throw new ImageServiceError('images_unavailable', 503, t(language, 'Генерация изображений временно недоступна.', 'Image generation is temporarily unavailable.'));
        }
        const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
        if (!prompt)
            throw new ImageServiceError('invalid_request', 400, t(language, 'Опишите, что нарисовать.', 'Describe what to draw.'));
        if (prompt.length > MAX_PROMPT_CHARS) {
            throw new ImageServiceError('invalid_request', 400, t(language, `Описание длиннее ${MAX_PROMPT_CHARS} символов.`, `The description is longer than ${MAX_PROMPT_CHARS} characters.`));
        }
        const requested = getImageModel(typeof input.modelId === 'string' ? input.modelId : undefined) ?? getImageModel(DEFAULT_IMAGE_MODEL_ID);
        if (imageDailyLimit(requested, caller.plan) === 0) {
            throw new ImageServiceError('upgrade_required', 403, t(language, `Модель ${requested.name} доступна с тарифа ${requested.requiredPlan.toUpperCase()}.`, `${requested.name} requires the ${requested.requiredPlan.toUpperCase()} plan.`));
        }
        // Месячный бюджет тарифа общий с чатом: на 125% — отказ, при исчерпании — только самая дешёвая модель.
        const entitlements = EntitlementService.getEntitlements(caller.plan);
        const snapshot = this.deps.usageStore.getFairUseSnapshot(caller.userId);
        const budget = evaluateBudget(snapshot.estimatedCostLastMonth, entitlements.costBudget);
        if (budget.stage === 'hard_stop') {
            throw new ImageServiceError('fair_use_exceeded', 429, t(language, 'Ресурсная квота тарифа на этот период исчерпана.', 'Your plan resource quota for this period is used up.'));
        }
        // Суточные лимиты: когда лимит модели исчерпан, картинку делает запасная модель.
        let model = requested;
        if (budget.stage === 'exhausted')
            model = getImageModel(DEFAULT_IMAGE_MODEL_ID);
        const seen = new Set();
        while (this.deps.usageStore.getImagesLastDay(caller.userId, model.id) >= imageDailyLimit(model, caller.plan)) {
            seen.add(model.id);
            const next = model.fallbackModelId ? getImageModel(model.fallbackModelId) : undefined;
            if (!next || seen.has(next.id) || imageDailyLimit(next, caller.plan) === 0) {
                throw new ImageServiceError('image_limit', 429, t(language, 'Суточный лимит картинок исчерпан. Он обновится в течение суток; больше картинок даёт тариф выше.', 'Daily image limit reached. It renews within 24 hours; a higher plan gives more images.'));
            }
            model = next;
        }
        const aspect = typeof input.aspect === 'string' && input.aspect in ASPECT_SIZES ? input.aspect : '1:1';
        const size = ASPECT_SIZES[model.aspects.includes(aspect) ? aspect : '1:1'];
        if (this.inFlight.has(caller.userId)) {
            throw new ImageServiceError('concurrency_limit', 429, t(language, 'Дождитесь, пока создастся предыдущая картинка.', 'Wait until the previous image is ready.'));
        }
        this.inFlight.add(caller.userId);
        try {
            const verdict = await this.deps.moderator.check(prompt, signal);
            if (!verdict.allowed) {
                if (verdict.category === 'unavailable') {
                    throw new ImageServiceError('moderation_unavailable', 503, t(language, 'Не удалось проверить запрос. Попробуйте ещё раз через минуту.', 'Could not check the request. Try again in a minute.'));
                }
                const text = BLOCK_MESSAGES[verdict.category] ?? BLOCK_MESSAGES.other;
                throw new ImageServiceError('moderation_blocked', 422, language === 'en' ? text.en : text.ru);
            }
            const started = Date.now();
            let generated;
            try {
                generated = await this.deps.generator.generate({ model, prompt: verdict.promptEn, width: size.width, height: size.height, signal });
            }
            catch (error) {
                console.error(`[images] ${model.engine} не сгенерировала картинку:`, error instanceof Error ? error.message : error);
                this.record(caller.userId, model, 0, Date.now() - started, 'error');
                throw new ImageServiceError('provider_error', 502, t(language, 'Не удалось создать картинку. Попробуйте ещё раз.', 'Could not create the image. Please try again.'));
            }
            const meta = await this.deps.store.save({ userId: caller.userId, prompt, modelId: model.id, width: size.width, height: size.height, mime: generated.mime }, generated.bytes);
            this.record(caller.userId, model, imageCostUsd(model, size.width, size.height), Date.now() - started, 'success');
            return {
                image: this.toPublic(meta),
                replacedBy: model.id !== requested.id ? model.name : null,
            };
        }
        finally {
            this.inFlight.delete(caller.userId);
        }
    }
    record(userId, model, cost, latencyMs, status) {
        this.deps.usageStore.recordUsage({
            userId,
            conversationId: 'images',
            modelId: model.id,
            // Тип провайдера в учёте пока один; сама модель (flux-*) однозначно указывает на Cloudflare.
            provider: 'openrouter',
            inputTokens: 0,
            outputTokens: 0,
            estimatedCost: cost,
            latencyMs,
            status,
            source: 'provider',
            kind: 'image',
        });
    }
}
