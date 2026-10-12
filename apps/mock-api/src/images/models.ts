/**
 * Модели генерации изображений.
 *
 * Два провайдера:
 * - Cloudflare Workers AI — бесплатные 10 000 «нейронов» в сутки на весь сервис, сверх них $0.011
 *   за 1 000. FLUX.1 schnell (1024×1024, 57.6 нейрона ≈ $0.00063) и FLUX.2 klein 4B (≈ 104 нейрона
 *   на 1 Мп ≈ $0.00115). Хватает примерно на 170 картинок schnell в сутки бесплатно.
 * - Runware — платные модели для Pro и Ultra, цена за картинку 1 Мп (страницы моделей Runware,
 *   12.10.2026): FLUX.2 [dev] $0.009, Seedream 5.0 Flash $0.019, FLUX.2 [pro] $0.045,
 *   Nano Banana 2 $0.069. Точную цену Runware возвращает в ответе, в учёт идёт она.
 *
 * Суточные лимиты (на пользователя, скользящие 24 часа). Платные модели считаются по тому же
 * принципу, что и чат: лимит = месячный бюджет тарифа на платные картинки / 30 / цена картинки,
 * то есть одной моделью до лимита каждый день бюджета хватает примерно на месяц.
 *   Pro   ($3 в месяц → $0.10 в день): FLUX.2 dev 10, Seedream 5.
 *   Ultra ($6 в месяц → $0.20 в день): FLUX.2 dev 22, Seedream 10, FLUX.2 pro 4, Nano Banana 2 3.
 * Бюджет на платные картинки общий для всех платных моделей: когда он исчерпан за 30 дней, отвечают
 * модели Cloudflare. Сам расход входит и в общий месячный бюджет тарифа (вместе с чатом).
 * Когда лимит модели исчерпан, картинку делает запасная модель; когда исчерпан и её лимит — следующая.
 */

import type { PlanId } from '../types.js';

export type ImageAspect = '1:1' | '4:3' | '3:4' | '16:9' | '9:16';

export interface ImageModel {
  id: string;
  name: string;
  provider: 'cloudflare' | 'runware';
  /** Идентификатор модели у провайдера (Workers AI или AIR у Runware). */
  engine: string;
  /** Формат запроса Workers AI: JSON (schnell) или multipart (FLUX.2). У Runware не нужен. */
  request?: 'json' | 'multipart';
  /** Поддерживает ли модель размер, отличный от квадрата 1024×1024. */
  aspects: readonly ImageAspect[];
  requiredPlan: PlanId;
  /** Себестоимость картинки 1024×1024 в $ (у Cloudflare — по цене сверх бесплатного объёма). */
  costPer1MpUsd: number;
  fallbackModelId: string | null;
  /** Суточный лимит картинок по тарифам. */
  dailyLimits: Readonly<Partial<Record<'free' | 'plus' | 'pro' | 'ultra', number>>>;
}

export const IMAGE_MODELS: readonly ImageModel[] = [
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
  {
    id: 'flux-2-dev',
    name: 'FLUX.2 dev',
    provider: 'runware',
    engine: 'runware:400@1',
    aspects: ['1:1', '4:3', '3:4', '16:9', '9:16'],
    requiredPlan: 'pro',
    costPer1MpUsd: 0.009,
    fallbackModelId: 'flux-2-klein',
    dailyLimits: { pro: 10, ultra: 22 },
  },
  {
    id: 'seedream-5-flash',
    name: 'Seedream 5.0 Flash',
    provider: 'runware',
    engine: 'bytedance:seedream@5.0-flash',
    // Допустимые размеры Seedream отличаются от общих (1K — только квадрат), поэтому пока квадрат.
    aspects: ['1:1'],
    requiredPlan: 'pro',
    costPer1MpUsd: 0.019,
    fallbackModelId: 'flux-2-dev',
    dailyLimits: { pro: 5, ultra: 10 },
  },
  {
    id: 'flux-2-pro',
    name: 'FLUX.2 pro',
    provider: 'runware',
    engine: 'bfl:5@1',
    aspects: ['1:1', '4:3', '3:4', '16:9', '9:16'],
    requiredPlan: 'ultra',
    costPer1MpUsd: 0.045,
    fallbackModelId: 'seedream-5-flash',
    dailyLimits: { ultra: 4 },
  },
  {
    id: 'nano-banana-2',
    name: 'Nano Banana 2',
    provider: 'runware',
    engine: 'google:4@3',
    // Gemini принимает фиксированный набор размеров; квадрат 1024×1024 поддерживается всегда.
    aspects: ['1:1'],
    requiredPlan: 'ultra',
    costPer1MpUsd: 0.069,
    fallbackModelId: 'seedream-5-flash',
    dailyLimits: { ultra: 3 },
  },
];

export const DEFAULT_IMAGE_MODEL_ID = 'flux-schnell';

/** Размер картинки по пропорции (стороны кратны 64, около 1 мегапикселя). */
export const ASPECT_SIZES: Readonly<Record<ImageAspect, { width: number; height: number }>> = {
  '1:1': { width: 1024, height: 1024 },
  '4:3': { width: 1152, height: 896 },
  '3:4': { width: 896, height: 1152 },
  '16:9': { width: 1344, height: 768 },
  '9:16': { width: 768, height: 1344 },
};

export function getImageModel(id: string | undefined): ImageModel | undefined {
  return IMAGE_MODELS.find((model) => model.id === id);
}

const PLAN_KEY: Readonly<Record<string, 'free' | 'plus' | 'pro' | 'ultra'>> = {
  free: 'free',
  plus: 'plus',
  pro: 'pro',
  ultra: 'ultra',
  'gpt-pro': 'pro',
  'claude-pro': 'pro',
  'gemini-pro': 'pro',
};

/** Суточный лимит картинок модели на тарифе (0 — модель недоступна). */
export function imageDailyLimit(model: ImageModel, plan: string): number {
  const key = PLAN_KEY[plan] ?? 'free';
  return model.dailyLimits[key] ?? 0;
}

export function imageCostUsd(model: ImageModel, width: number, height: number): number {
  return Number(((model.costPer1MpUsd * width * height) / (1024 * 1024)).toFixed(6));
}

/**
 * Месячный бюджет на платные картинки (модели Runware) по тарифам, $ за скользящие 30 дней.
 * Около четверти общего бюджета тарифа, чтобы картинки не съедали чат.
 */
export const PAID_IMAGE_BUDGET_USD: Readonly<Record<'free' | 'plus' | 'pro' | 'ultra', number>> = {
  free: 0,
  plus: 0,
  pro: 3,
  ultra: 6,
};

export function paidImageBudget(plan: string): number {
  return PAID_IMAGE_BUDGET_USD[PLAN_KEY[plan] ?? 'free'];
}

export const PAID_IMAGE_MODEL_IDS: readonly string[] = IMAGE_MODELS.filter((m) => m.provider === 'runware').map((m) => m.id);

