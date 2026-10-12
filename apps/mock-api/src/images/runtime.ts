/** Общие экземпляры генерации картинок (создаются лениво). */

import { createHmac } from 'node:crypto';
import { config } from '../config.js';
import { providerManager } from '../ai/providers/provider-factory.js';
import { modelRegistry } from '../ai/model-registry.js';
import { createCloudflareGenerator } from './cloudflare.js';
import { ImageStore, type ImageSqlRunner } from './image-store.js';
import { createLlmModerator } from './moderation.js';
import { ImageService } from './service.js';
import type { UsageStore } from '../store/usage-store.js';

let store: ImageStore | null = null;
let service: ImageService | null = null;

export function getImageStore(): ImageStore {
  if (!store) store = new ImageStore(config.images.dir);
  return store;
}

export function attachImageDriver(runner: ImageSqlRunner | null): void {
  getImageStore().setDriver(runner);
}

/** Сервис генерации для приложения: учёт расхода идёт в общий usageStore (бюджет тарифа общий с чатом). */
export function getImageService(usageStore: UsageStore): ImageService {
  if (!service) {
    service = new ImageService({
      store: getImageStore(),
      usageStore,
      generator: createCloudflareGenerator({
        accountId: config.images.cloudflareAccountId,
        apiToken: config.images.cloudflareApiToken,
      }),
      moderator: createLlmModerator({
        provider: () => providerManager.get('openrouter'),
        model: modelRegistry.resolve('ketner-mini').providerModelId,
      }),
      urlSecret: createHmac('sha256', config.authJwtSecret).update('ketner:image-urls:v1').digest('hex'),
    });
  }
  return service;
}
