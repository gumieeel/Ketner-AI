/** Общие экземпляры генерации картинок (создаются лениво). */

import { createHmac } from 'node:crypto';
import { config } from '../config.js';
import { providerManager } from '../ai/providers/provider-factory.js';
import { modelRegistry } from '../ai/model-registry.js';
import { createCloudflareGenerator } from './cloudflare.js';
import { combineGenerators, createRunwareGenerator } from './runware.js';
import { ImageStore, type ImageSqlRunner } from './image-store.js';
import { createLlmModerator } from './moderation.js';
import { ImageService } from './service.js';
import type { CreditLedger } from '../services/credits.js';
import type { UsageStore } from '../store/usage-store.js';

let store: ImageStore | null = null;
/** Сервис на журнал кредитов: в приложении он один, в тестах у каждого сервера свой. */
const services = new Map<CreditLedger | 'default', ImageService>();

export function getImageStore(): ImageStore {
  if (!store) store = new ImageStore(config.images.dir);
  return store;
}

export function attachImageDriver(runner: ImageSqlRunner | null): void {
  getImageStore().setDriver(runner);
}

/** Сервис генерации для приложения: учёт расхода идёт в общий usageStore (бюджет тарифа общий с чатом). */
export function getImageService(usageStore: UsageStore, credits?: CreditLedger): ImageService {
  let service = services.get(credits ?? 'default');
  if (!service) {
    service = new ImageService({
      ...(credits ? { credits } : {}),
      store: getImageStore(),
      usageStore,
      generator: combineGenerators(
        createCloudflareGenerator({
          accountId: config.images.cloudflareAccountId,
          apiToken: config.images.cloudflareApiToken,
        }),
        createRunwareGenerator({ apiKey: config.images.runwareApiKey }),
      ),
      moderator: createLlmModerator({
        provider: () => providerManager.get('openrouter'),
        model: modelRegistry.resolve('ketner-mini').providerModelId,
      }),
      urlSecret: createHmac('sha256', config.authJwtSecret)
        .update('ketner:image-urls:v1')
        .digest('hex'),
    });
    services.set(credits ?? 'default', service);
  }
  return service;
}
