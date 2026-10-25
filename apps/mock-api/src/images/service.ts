/**
 * Генерация картинок: тариф, кредиты (один пул с чатом и Ketner Code), суточные лимиты с запасной
 * моделью, проверка запроса, генерация, сохранение, списание кредитов и учёт расхода.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { creditService } from '../billing/index.js';
import { creditStageOf } from '../services/credit-policy.js';
import type { CreditLedger } from '../services/credits.js';
import { CREDITS_PER_USD, toCredits } from '../services/entitlement.js';
import type { UsageStore } from '../store/usage-store.js';
import type { ImageGenerator } from './cloudflare.js';
import type { ImageMeta, ImageStore } from './image-store.js';
import type { PromptModerator } from './moderation.js';
import { applyImageStyle, DEFAULT_IMAGE_STYLE_ID, IMAGE_STYLES } from './styles.js';
import {
  ASPECT_SIZES,
  DEFAULT_IMAGE_MODEL_ID,
  IMAGE_MODELS,
  getImageModel,
  imageCostUsd,
  FREE_IMAGES_PER_DAY,
  imageDailyLimit,
  type ImageAspect,
  type ImageModel,
} from './models.js';

export const MAX_PROMPT_CHARS = 1_000;
const URL_TTL_SECONDS = 6 * 60 * 60;

export type ImageErrorCode =
  | 'invalid_request'
  | 'upgrade_required'
  | 'image_limit'
  | 'concurrency_limit'
  | 'moderation_blocked'
  | 'moderation_unavailable'
  | 'images_unavailable'
  | 'provider_error';

export class ImageServiceError extends Error {
  constructor(
    readonly code: ImageErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ImageCaller {
  userId: string;
  plan: string;
  language: 'ru' | 'en';
}

export interface PublicImage {
  id: string;
  prompt: string;
  modelId: string;
  modelName: string;
  width: number;
  height: number;
  createdAt: string;
  url: string;
  downloadUrl: string;
}

const t = (language: 'ru' | 'en', ru: string, en: string): string => (language === 'en' ? en : ru);

const BLOCK_MESSAGES: Record<string, { ru: string; en: string }> = {
  minors: {
    ru: 'Запрос нарушает правила: изображения сексуального характера с участием несовершеннолетних запрещены.',
    en: 'This request violates the rules: sexual imagery involving minors is prohibited.',
  },
  sexual: {
    ru: 'Откровенные и сексуальные изображения создавать нельзя.',
    en: 'Explicit or sexual images cannot be generated.',
  },
  real_person: {
    ru: 'Нельзя создавать унизительные, сексуальные или поддельные изображения реальных людей.',
    en: 'Humiliating, sexual or fake images of real people cannot be generated.',
  },
  violence: {
    ru: 'Изображения с жестоким насилием создавать нельзя.',
    en: 'Graphic violence cannot be generated.',
  },
  hate: {
    ru: 'Изображения с символикой ненависти создавать нельзя.',
    en: 'Hateful imagery cannot be generated.',
  },
  other: {
    ru: 'Такое изображение создать нельзя: запрос нарушает правила сервиса.',
    en: 'This image cannot be generated: the request violates the service rules.',
  },
};

export class ImageService {
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly deps: {
      store: ImageStore;
      usageStore: UsageStore;
      generator: ImageGenerator;
      moderator: PromptModerator;
      urlSecret: string;
      /** Кредиты пользователей; по умолчанию — общий журнал биллинга. */
      credits?: CreditLedger;
    },
  ) {}

  private get credits(): CreditLedger {
    return this.deps.credits ?? creditService;
  }

  get available(): boolean {
    return this.deps.generator.available;
  }

  capabilities(caller: ImageCaller) {
    const balance = this.credits.balance(caller.userId, caller.plan as never);
    return {
      available: this.available,
      credits: {
        balance: toCredits(balance.remainingUsd),
        exhausted: creditStageOf(balance.remainingUsd) === 'exhausted',
        freePerDay: FREE_IMAGES_PER_DAY,
      },
      defaultModelId: DEFAULT_IMAGE_MODEL_ID,
      defaultStyleId: DEFAULT_IMAGE_STYLE_ID,
      styles: IMAGE_STYLES.map((style) => style.id),
      maxPromptChars: MAX_PROMPT_CHARS,
      // Платные модели без ключа Runware не показываются; модели Cloudflare — основа страницы, без них
      // страница и так сообщает, что генерация недоступна.
      models: IMAGE_MODELS.filter(
        (model) => model.provider === 'cloudflare' || this.supports(model),
      ).map((model) => {
        const dailyLimit = imageDailyLimit(model, caller.plan);
        return {
          id: model.id,
          name: model.name,
          aspects: model.aspects,
          requiredPlan: model.requiredPlan,
          locked: dailyLimit === 0,
          /** Цена одной картинки 1024×1024 в кредитах (с десятыми). */
          priceCredits: Math.round(imageCostUsd(model, 1024, 1024) * CREDITS_PER_USD * 10) / 10,
          dailyLimit,
          usedToday: this.deps.usageStore.getImagesLastDay(caller.userId, model.id),
        };
      }),
    };
  }

  private supports(model: ImageModel): boolean {
    const { generator } = this.deps;
    return generator.supports ? generator.supports(model) : generator.available;
  }

  /**
   * Модель, которая нарисует картинку: начиная с `start` по цепочке запасных. Пропускаются модели без
   * настроенного провайдера, с исчерпанным суточным лимитом и те, на которые не хватает кредитов.
   * Когда кредитов нет совсем, рисует только FLUX.1 schnell и не больше FREE_IMAGES_PER_DAY в сутки.
   * null — рисовать нечем.
   */
  private pickModel(
    start: ImageModel,
    caller: ImageCaller,
    options: { balanceUsd: number; skip?: ReadonlySet<string> },
  ): ImageModel | null {
    const exhausted = creditStageOf(options.balanceUsd) === 'exhausted';
    const seen = new Set<string>();
    let model: ImageModel | undefined = exhausted ? getImageModel(DEFAULT_IMAGE_MODEL_ID) : start;
    while (model && !seen.has(model.id)) {
      seen.add(model.id);
      const dailyLimit = exhausted
        ? Math.min(imageDailyLimit(model, caller.plan), FREE_IMAGES_PER_DAY)
        : imageDailyLimit(model, caller.plan);
      const usable =
        !options.skip?.has(model.id) &&
        this.supports(model) &&
        dailyLimit > 0 &&
        (exhausted || options.balanceUsd >= imageCostUsd(model, 1024, 1024)) &&
        this.deps.usageStore.getImagesLastDay(caller.userId, model.id) < dailyLimit;
      if (usable) return model;
      model = model.fallbackModelId ? getImageModel(model.fallbackModelId) : undefined;
    }
    return null;
  }

  private sign(id: string, exp: number): string {
    return createHmac('sha256', this.deps.urlSecret)
      .update(`image:${id}:${exp}`)
      .digest('base64url');
  }

  /** Подпись ссылки на файл: картинки открываются в <img> и скачиваются без заголовка авторизации. */
  verify(id: string, exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
    const expected = Buffer.from(this.sign(id, exp));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  toPublic(meta: ImageMeta, base = '/api/images'): PublicImage {
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

  async list(caller: ImageCaller): Promise<PublicImage[]> {
    return (await this.deps.store.list(caller.userId)).map((meta) => this.toPublic(meta));
  }

  async generate(
    caller: ImageCaller,
    input: { prompt: unknown; modelId?: unknown; aspect?: unknown; style?: unknown },
    signal?: AbortSignal,
  ): Promise<{ image: PublicImage; replacedBy: string | null }> {
    const { language } = caller;
    if (!this.available) {
      throw new ImageServiceError(
        'images_unavailable',
        503,
        t(
          language,
          'Генерация изображений временно недоступна.',
          'Image generation is temporarily unavailable.',
        ),
      );
    }
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
    if (!prompt)
      throw new ImageServiceError(
        'invalid_request',
        400,
        t(language, 'Опишите, что нарисовать.', 'Describe what to draw.'),
      );
    if (prompt.length > MAX_PROMPT_CHARS) {
      throw new ImageServiceError(
        'invalid_request',
        400,
        t(
          language,
          `Описание длиннее ${MAX_PROMPT_CHARS} символов.`,
          `The description is longer than ${MAX_PROMPT_CHARS} characters.`,
        ),
      );
    }

    const requested =
      getImageModel(typeof input.modelId === 'string' ? input.modelId : undefined) ??
      getImageModel(DEFAULT_IMAGE_MODEL_ID)!;
    if (imageDailyLimit(requested, caller.plan) === 0) {
      throw new ImageServiceError(
        'upgrade_required',
        403,
        t(
          language,
          `Модель ${requested.name} доступна с тарифа ${requested.requiredPlan.toUpperCase()}.`,
          `${requested.name} requires the ${requested.requiredPlan.toUpperCase()} plan.`,
        ),
      );
    }

    // Кредиты общие с чатом и Ketner Code. Не хватает на выбранную модель — рисует запасная из цепочки;
    // кредитов нет совсем — только FLUX.1 schnell в пределах бесплатного суточного лимита.
    const balanceUsd = this.credits.balance(caller.userId, caller.plan as never).remainingUsd;
    const picked = this.pickModel(requested, caller, { balanceUsd });
    if (!picked) {
      throw new ImageServiceError(
        'image_limit',
        429,
        t(
          language,
          'Суточный лимит картинок исчерпан. Он обновится в течение суток; больше картинок даёт тариф выше.',
          'Daily image limit reached. It renews within 24 hours; a higher plan gives more images.',
        ),
      );
    }
    let model: ImageModel = picked;

    const aspect: ImageAspect =
      typeof input.aspect === 'string' && input.aspect in ASPECT_SIZES
        ? (input.aspect as ImageAspect)
        : '1:1';
    const sizeFor = (m: ImageModel) => ASPECT_SIZES[m.aspects.includes(aspect) ? aspect : '1:1'];

    if (this.inFlight.has(caller.userId)) {
      throw new ImageServiceError(
        'concurrency_limit',
        429,
        t(
          language,
          'Дождитесь, пока создастся предыдущая картинка.',
          'Wait until the previous image is ready.',
        ),
      );
    }
    this.inFlight.add(caller.userId);
    try {
      const verdict = await this.deps.moderator.check(prompt, signal);
      if (!verdict.allowed) {
        if (verdict.category === 'unavailable') {
          throw new ImageServiceError(
            'moderation_unavailable',
            503,
            t(
              language,
              'Не удалось проверить запрос. Попробуйте ещё раз через минуту.',
              'Could not check the request. Try again in a minute.',
            ),
          );
        }
        const text = BLOCK_MESSAGES[verdict.category] ?? BLOCK_MESSAGES.other;
        throw new ImageServiceError(
          'moderation_blocked',
          422,
          language === 'en' ? text.en : text.ru,
        );
      }

      // Платный провайдер может не ответить (например, кончился баланс Runware): тогда картинку рисует
      // следующая модель цепочки, и интерфейс показывает, какая модель ответила.
      // Стиль дописывается после проверки: проверяется описание пользователя, подсказки стилей задаёт сервер.
      const modelPrompt = applyImageStyle(verdict.promptEn, input.style);
      const failed = new Set<string>();
      let generated;
      let size = sizeFor(model);
      let started = Date.now();
      for (;;) {
        size = sizeFor(model);
        started = Date.now();
        try {
          generated = await this.deps.generator.generate({
            model,
            prompt: modelPrompt,
            width: size.width,
            height: size.height,
            signal,
          });
          break;
        } catch (error) {
          console.error(
            `[images] ${model.engine} не сгенерировала картинку:`,
            error instanceof Error ? error.message : error,
          );
          this.record(caller.userId, model, 0, Date.now() - started, 'error');
          failed.add(model.id);
          const next: ImageModel | null =
            signal?.aborted || model.provider !== 'runware'
              ? null
              : this.pickModel(model, caller, { balanceUsd, skip: failed });
          if (!next) {
            throw new ImageServiceError(
              'provider_error',
              502,
              t(
                language,
                'Не удалось создать картинку. Попробуйте ещё раз.',
                'Could not create the image. Please try again.',
              ),
            );
          }
          model = next;
        }
      }

      const meta = await this.deps.store.save(
        {
          userId: caller.userId,
          prompt,
          modelId: model.id,
          width: size.width,
          height: size.height,
          mime: generated.mime,
        },
        generated.bytes,
      );
      const costUsd = generated.costUsd ?? imageCostUsd(model, size.width, size.height);
      this.record(
        caller.userId,
        model,
        costUsd,
        Date.now() - started,
        'success',
        this.credits.charge(caller.userId, costUsd),
      );
      return {
        image: this.toPublic(meta),
        replacedBy: model.id !== requested.id ? model.name : null,
      };
    } finally {
      this.inFlight.delete(caller.userId);
    }
  }

  private record(
    userId: string,
    model: ImageModel,
    cost: number,
    latencyMs: number,
    status: 'success' | 'error',
    creditsUsd = 0,
  ): void {
    this.deps.usageStore.recordUsage({
      userId,
      conversationId: 'images',
      creditsUsd,
      modelId: model.id,
      // Тип провайдера в учёте один на все ИИ-запросы; провайдер картинки однозначно задаёт id модели.
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
