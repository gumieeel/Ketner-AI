/**
 * Модели генерации изображений.
 *
 * Сейчас всё идёт через Cloudflare Workers AI: у аккаунта есть бесплатный объём 10 000 «нейронов»
 * в сутки, сверх него $0.011 за 1 000. Цены за картинку (Cloudflare, 12.10.2026):
 *   FLUX.1 schnell   1024×1024, 4 шага: 4 тайла × 4.8 + 4 шага × 9.6 = 57.6 нейронов ≈ $0.00063
 *   FLUX.2 klein 4B  выход 26.05 нейронов за тайл 512×512: 1024×1024 ≈ 104 нейрона ≈ $0.00115
 * Бесплатного объёма хватает примерно на 170 картинок schnell или 95 klein в сутки на весь сервис.
 *
 * Суточные лимиты (на пользователя, скользящие 24 часа). Когда лимит модели исчерпан, картинку
 * делает запасная модель (klein → schnell); когда исчерпан и её лимит — генерация до завтра.
 */
export const IMAGE_MODELS = [
    {
        id: 'flux-schnell',
        name: 'FLUX.1 schnell',
        provider: 'cloudflare',
        engine: '@cf/black-forest-labs/flux-1-schnell',
        request: 'json',
        aspects: ['1:1'],
        requiredPlan: 'free',
        costPer1MpUsd: 0.00063,
        fallbackModelId: null,
        dailyLimits: { free: 5, plus: 50, pro: 100, ultra: 200 },
    },
    {
        id: 'flux-2-klein',
        name: 'FLUX.2 klein',
        provider: 'cloudflare',
        engine: '@cf/black-forest-labs/flux-2-klein-4b',
        request: 'multipart',
        aspects: ['1:1', '4:3', '3:4', '16:9', '9:16'],
        requiredPlan: 'plus',
        costPer1MpUsd: 0.00115,
        fallbackModelId: 'flux-schnell',
        dailyLimits: { plus: 20, pro: 50, ultra: 120 },
    },
];
export const DEFAULT_IMAGE_MODEL_ID = 'flux-schnell';
/** Размер картинки по пропорции (стороны кратны 64, около 1 мегапикселя). */
export const ASPECT_SIZES = {
    '1:1': { width: 1024, height: 1024 },
    '4:3': { width: 1152, height: 896 },
    '3:4': { width: 896, height: 1152 },
    '16:9': { width: 1344, height: 768 },
    '9:16': { width: 768, height: 1344 },
};
export function getImageModel(id) {
    return IMAGE_MODELS.find((model) => model.id === id);
}
const PLAN_KEY = {
    free: 'free',
    plus: 'plus',
    pro: 'pro',
    ultra: 'ultra',
    'gpt-pro': 'pro',
    'claude-pro': 'pro',
    'gemini-pro': 'pro',
};
/** Суточный лимит картинок модели на тарифе (0 — модель недоступна). */
export function imageDailyLimit(model, plan) {
    const key = PLAN_KEY[plan] ?? 'free';
    return model.dailyLimits[key] ?? 0;
}
export function imageCostUsd(model, width, height) {
    return Number(((model.costPer1MpUsd * width * height) / (1024 * 1024)).toFixed(6));
}
