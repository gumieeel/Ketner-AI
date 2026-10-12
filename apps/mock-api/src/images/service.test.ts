import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageStore } from '../store/usage-store.js';
import { ImageStore } from './image-store.js';
import { ImageService, ImageServiceError } from './service.js';
import { createLlmModerator, isObviouslyForbidden, type PromptModerator } from './moderation.js';
import { createCloudflareGenerator, type ImageGenerator } from './cloudflare.js';
import type { AIProvider } from '../ai/gateway-types.js';
import { PLAN_ENTITLEMENTS } from '../services/entitlement.js';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(200, 1)]);

function setup(options: { moderator?: PromptModerator; generator?: Partial<ImageGenerator> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ketner-img-'));
  const usage = new UsageStore(join(dir, 'usage.json'));
  const calls: Array<{ model: string; prompt: string; width: number; height: number }> = [];
  const generator: ImageGenerator = {
    available: true,
    async generate({ model, prompt, width, height }) {
      calls.push({ model: model.id, prompt, width, height });
      return { bytes: JPEG, mime: 'image/jpeg' };
    },
    ...options.generator,
  };
  const moderator: PromptModerator = options.moderator ?? { check: async (p) => ({ allowed: true, promptEn: `EN: ${p}` }) };
  const store = new ImageStore(join(dir, 'images'));
  const service = new ImageService({ store, usageStore: usage, generator, moderator, urlSecret: 'secret' });
  return { service, usage, calls, store };
}

const caller = (plan: string, userId = 'u1') => ({ userId, plan, language: 'ru' as const });

test('Free: FLUX.1 schnell, 5 в сутки, картинка сохраняется и отдаётся по подписанной ссылке', async () => {
  const { service, calls, store } = setup();
  const { image, replacedBy } = await service.generate(caller('free'), { prompt: 'лиса в снегу', aspect: '16:9' });
  assert.equal(replacedBy, null);
  assert.equal(image.modelId, 'flux-schnell');
  assert.deepEqual([image.width, image.height], [1024, 1024], 'schnell — только квадрат');
  assert.equal(calls[0].prompt, 'EN: лиса в снегу', 'в модель уходит английский перевод');
  const params = new URL(image.url, 'http://x').searchParams;
  assert.ok(service.verify(image.id, Number(params.get('exp')), params.get('sig') ?? ''));
  assert.equal(service.verify(image.id, Number(params.get('exp')), 'forged'), false);
  assert.ok(await store.getById(image.id));
  for (let i = 0; i < 4; i++) await service.generate(caller('free'), { prompt: `картинка ${i}` });
  await assert.rejects(service.generate(caller('free'), { prompt: 'ещё' }), (e: unknown) => e instanceof ImageServiceError && e.code === 'image_limit');
  assert.equal((await service.list(caller('free'))).length, 5);
});

test('Free: FLUX.2 klein закрыта, на Plus — с размером; после лимита klein отвечает schnell', async () => {
  const { service, usage } = setup();
  await assert.rejects(service.generate(caller('free'), { prompt: 'кот', modelId: 'flux-2-klein' }), (e: unknown) => e instanceof ImageServiceError && e.code === 'upgrade_required');
  const first = await service.generate(caller('plus'), { prompt: 'кот', modelId: 'flux-2-klein', aspect: '16:9' });
  assert.deepEqual([first.image.modelId, first.image.width, first.image.height], ['flux-2-klein', 1344, 768]);
  for (let i = 0; i < 19; i++) await service.generate(caller('plus'), { prompt: `кот ${i}`, modelId: 'flux-2-klein' });
  const over = await service.generate(caller('plus'), { prompt: 'кот', modelId: 'flux-2-klein' });
  assert.equal(over.image.modelId, 'flux-schnell');
  assert.equal(over.replacedBy, 'FLUX.1 schnell');
  assert.ok(usage.getFairUseSnapshot('u1').estimatedCostLastDay > 0, 'расход идёт в бюджет тарифа');
  assert.equal(usage.getFairUseSnapshot('u1').requestsLastDay, 0, 'картинки не тратят лимит сообщений чата');
});

test('проверка запроса: запрещённое не генерируется, без проверки — тоже', async () => {
  const blocked = setup({ moderator: { check: async () => ({ allowed: false, category: 'sexual' }) } });
  await assert.rejects(blocked.service.generate(caller('pro'), { prompt: 'x' }), (e: unknown) => e instanceof ImageServiceError && e.code === 'moderation_blocked');
  assert.equal(blocked.calls.length, 0);
  const down = setup({ moderator: { check: async () => ({ allowed: false, category: 'unavailable' }) } });
  await assert.rejects(down.service.generate(caller('pro'), { prompt: 'x' }), (e: unknown) => e instanceof ImageServiceError && e.code === 'moderation_unavailable');
  assert.equal(down.calls.length, 0);
});

test('локальный фильтр сразу блокирует сексуальный контент с несовершеннолетними', () => {
  assert.equal(isObviouslyForbidden('голая девочка'), true);
  assert.equal(isObviouslyForbidden('naked teen girl'), true);
  assert.equal(isObviouslyForbidden('loli art'), true);
  assert.equal(isObviouslyForbidden('девочка с котом в парке'), false);
  assert.equal(isObviouslyForbidden('рыцарь на драконе'), false);
});

test('модератор: модель не вызывается для явно запрещённого; ошибка модели — запрос не проходит', async () => {
  let called = 0;
  const provider = (content: string | Error) =>
    ({
      isAvailable: () => true,
      generateText: async () => {
        called += 1;
        if (content instanceof Error) throw content;
        return { content, usage: { inputTokens: 1, outputTokens: 1 }, finishReason: 'stop' };
      },
    }) as unknown as AIProvider;
  const ok = createLlmModerator({ provider: () => provider('{"allowed": true, "category": "none", "prompt_en": "a fox in the snow"}'), model: 'm' });
  assert.deepEqual(await ok.check('лиса в снегу'), { allowed: true, promptEn: 'a fox in the snow' });
  const bad = createLlmModerator({ provider: () => provider('{"allowed": false, "category": "violence"}'), model: 'm' });
  assert.deepEqual(await bad.check('x'), { allowed: false, category: 'violence' });
  const broken = createLlmModerator({ provider: () => provider(new Error('down')), model: 'm' });
  assert.deepEqual(await broken.check('x'), { allowed: false, category: 'unavailable' });
  called = 0;
  assert.deepEqual(await ok.check('голая школьница'), { allowed: false, category: 'minors' });
  assert.equal(called, 0);
});

test('бюджет: на 125% — отказ, при исчерпании — только schnell; сбой провайдера не тратит лимит', async () => {
  const { service, usage } = setup();
  const seed = (cost: number) => {
    const rec = usage.recordUsage({ userId: 'u2', conversationId: 'c', modelId: 'ketner-pro', provider: 'openrouter', inputTokens: 1, outputTokens: 1, estimatedCost: cost, latencyMs: 1, status: 'success' });
    rec.createdAt = new Date(Date.now() - 3 * 86400000).toISOString();
  };
  seed(PLAN_ENTITLEMENTS.plus.costBudget * 1.05);
  const cheap = await service.generate(caller('plus', 'u2'), { prompt: 'кот', modelId: 'flux-2-klein' });
  assert.equal(cheap.image.modelId, 'flux-schnell');
  seed(PLAN_ENTITLEMENTS.plus.costBudget * 0.3);
  await assert.rejects(service.generate(caller('plus', 'u2'), { prompt: 'кот' }), (e: unknown) => e instanceof ImageServiceError && e.code === 'fair_use_exceeded');

  const failing = setup({ generator: { generate: async () => { throw new Error('boom'); } } });
  await assert.rejects(failing.service.generate(caller('free'), { prompt: 'кот' }), (e: unknown) => e instanceof ImageServiceError && e.code === 'provider_error');
  assert.equal(failing.usage.getImagesLastDay('u1', 'flux-schnell'), 0);
});

test('Cloudflare: schnell — JSON, klein — multipart с размером; ответ base64 превращается в байты', async () => {
  const requests: Array<{ url: string; body: unknown; contentType?: string }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    requests.push({ url, body: init.body, contentType: (init.headers as Record<string, string>)['Content-Type'] });
    return new Response(JSON.stringify({ result: { image: JPEG.toString('base64') } }), { status: 200 });
  }) as unknown as typeof fetch;
  const generator = createCloudflareGenerator({ accountId: 'acc', apiToken: 'tok', fetchImpl });
  const { IMAGE_MODELS } = await import('./models.js');
  const schnell = await generator.generate({ model: IMAGE_MODELS[0], prompt: 'fox', width: 1024, height: 1024 });
  assert.equal(schnell.mime, 'image/jpeg');
  assert.ok(schnell.bytes.equals(JPEG));
  assert.match(requests[0].url, /accounts\/acc\/ai\/run\/@cf\/black-forest-labs\/flux-1-schnell$/);
  assert.equal(requests[0].contentType, 'application/json');
  await generator.generate({ model: IMAGE_MODELS[1], prompt: 'fox', width: 1344, height: 768 });
  const form = requests[1].body as FormData;
  assert.equal(form.get('width'), '1344');
  assert.equal(form.get('height'), '768');
  assert.equal(createCloudflareGenerator({ accountId: '', apiToken: '' }).available, false);
});
