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
import { combineGenerators, createRunwareGenerator } from './runware.js';
import type { AIProvider } from '../ai/gateway-types.js';
import { toUsd } from '../services/credits.js';
import { memoryCredits, setBalance } from '../services/credits-fixture.js';
import { TRIAL_CREDITS } from '../services/entitlement.js';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(200, 1)]);

function setup(options: { moderator?: PromptModerator; generator?: Partial<ImageGenerator> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ketner-img-'));
  const usage = new UsageStore(join(dir, 'usage.json'));
  const calls: Array<{ model: string; prompt: string; width: number; height: number }> = [];
  const generator: ImageGenerator = {
    available: true,
    async generate({ model, prompt, width, height }) {
      calls.push({ model: model.id, prompt, width, height });
      return {
        bytes: JPEG,
        mime: 'image/jpeg',
        costUsd: model.provider === 'runware' ? 0.0123 : undefined,
      };
    },
    ...options.generator,
  };
  const moderator: PromptModerator = options.moderator ?? {
    check: async (p) => ({ allowed: true, promptEn: `EN: ${p}` }),
  };
  const store = new ImageStore(join(dir, 'images'));
  const credits = memoryCredits();
  const service = new ImageService({
    store,
    usageStore: usage,
    generator,
    moderator,
    urlSecret: 'secret',
    credits,
  });
  return { service, usage, calls, store, credits };
}

const caller = (plan: string, userId = 'u1') => ({ userId, plan, language: 'ru' as const });

test('Free: FLUX.1 schnell, 5 в сутки, картинка сохраняется и отдаётся по подписанной ссылке', async () => {
  const { service, calls, store } = setup();
  const { image, replacedBy } = await service.generate(caller('free'), {
    prompt: 'лиса в снегу',
    aspect: '16:9',
  });
  assert.equal(replacedBy, null);
  assert.equal(image.modelId, 'flux-schnell');
  assert.deepEqual([image.width, image.height], [1024, 1024], 'schnell — только квадрат');
  assert.equal(calls[0].prompt, 'EN: лиса в снегу', 'в модель уходит английский перевод');
  const params = new URL(image.url, 'http://x').searchParams;
  assert.ok(service.verify(image.id, Number(params.get('exp')), params.get('sig') ?? ''));
  assert.equal(service.verify(image.id, Number(params.get('exp')), 'forged'), false);
  assert.ok(await store.getById(image.id));
  for (let i = 0; i < 4; i++) await service.generate(caller('free'), { prompt: `картинка ${i}` });
  await assert.rejects(
    service.generate(caller('free'), { prompt: 'ещё' }),
    (e: unknown) => e instanceof ImageServiceError && e.code === 'image_limit',
  );
  assert.equal((await service.list(caller('free'))).length, 5);
});

test('Free: FLUX.2 klein открыта с размером, 5 в сутки; после лимита klein отвечает schnell', async () => {
  const { service, usage } = setup();
  const first = await service.generate(caller('free'), {
    prompt: 'кот',
    modelId: 'flux-2-klein',
    aspect: '16:9',
  });
  assert.deepEqual(
    [first.image.modelId, first.image.width, first.image.height],
    ['flux-2-klein', 1344, 768],
  );
  for (let i = 0; i < 4; i++)
    await service.generate(caller('free'), { prompt: `кот ${i}`, modelId: 'flux-2-klein' });
  const over = await service.generate(caller('free'), { prompt: 'кот', modelId: 'flux-2-klein' });
  assert.equal(over.image.modelId, 'flux-schnell');
  assert.equal(over.replacedBy, 'FLUX.1 schnell');
  assert.ok(usage.getFairUseSnapshot('u1').estimatedCostLastDay > 0, 'расход идёт в бюджет тарифа');
  assert.equal(
    usage.getFairUseSnapshot('u1').requestsLastDay,
    0,
    'картинки не тратят лимит сообщений чата',
  );

  // Покупатель кредитов и подписчик Plus рисуют той же моделью с более высоким лимитом.
  const plus = await service.generate(caller('plus', 'u9'), {
    prompt: 'кот',
    modelId: 'flux-2-klein',
  });
  assert.equal(plus.image.modelId, 'flux-2-klein');
});

test('проверка запроса: запрещённое не генерируется, без проверки — тоже', async () => {
  const blocked = setup({
    moderator: { check: async () => ({ allowed: false, category: 'sexual' }) },
  });
  await assert.rejects(
    blocked.service.generate(caller('pro'), { prompt: 'x' }),
    (e: unknown) => e instanceof ImageServiceError && e.code === 'moderation_blocked',
  );
  assert.equal(blocked.calls.length, 0);
  const down = setup({
    moderator: { check: async () => ({ allowed: false, category: 'unavailable' }) },
  });
  await assert.rejects(
    down.service.generate(caller('pro'), { prompt: 'x' }),
    (e: unknown) => e instanceof ImageServiceError && e.code === 'moderation_unavailable',
  );
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
  const ok = createLlmModerator({
    provider: () =>
      provider('{"allowed": true, "category": "none", "prompt_en": "a fox in the snow"}'),
    model: 'm',
  });
  assert.deepEqual(await ok.check('лиса в снегу'), {
    allowed: true,
    promptEn: 'a fox in the snow',
  });
  const bad = createLlmModerator({
    provider: () => provider('{"allowed": false, "category": "violence"}'),
    model: 'm',
  });
  assert.deepEqual(await bad.check('x'), { allowed: false, category: 'violence' });
  const broken = createLlmModerator({ provider: () => provider(new Error('down')), model: 'm' });
  assert.deepEqual(await broken.check('x'), { allowed: false, category: 'unavailable' });
  called = 0;
  assert.deepEqual(await ok.check('голая школьница'), { allowed: false, category: 'minors' });
  assert.equal(called, 0);
});

test('кредиты: картинка списывает свою цену; когда кредиты кончились, рисует только schnell и не больше 5 в сутки', async () => {
  const { service, usage, credits } = setup();
  setBalance(credits, 'u2', 'plus', 0.5); // меньше одного кредита — кредитов нет
  assert.equal(service.capabilities(caller('plus', 'u2')).credits.exhausted, true);
  const cheap = await service.generate(caller('plus', 'u2'), {
    prompt: 'кот',
    modelId: 'flux-2-klein',
  });
  assert.equal(cheap.image.modelId, 'flux-schnell');
  assert.equal(cheap.replacedBy, 'FLUX.1 schnell');
  for (let i = 0; i < 4; i++)
    await service.generate(caller('plus', 'u2'), { prompt: `кот ${i}`, modelId: 'flux-2-klein' });
  await assert.rejects(
    service.generate(caller('plus', 'u2'), { prompt: 'кот' }),
    (e: unknown) => e instanceof ImageServiceError && e.code === 'image_limit',
  );

  // Пока кредиты есть, картинка списывает свою себестоимость (schnell ≈ $0.00063)
  const rich = setup();
  const before = rich.credits.balance('u1', 'plus').remainingUsd;
  await rich.service.generate(caller('plus'), { prompt: 'кот' });
  const spent = before - rich.credits.balance('u1', 'plus').remainingUsd;
  assert.ok(spent > 0 && spent < 0.001, `списано ${spent}`);
  assert.ok(Math.abs((rich.usage.getByUser('u1')[0].creditsUsd ?? 0) - spent) < 1e-9);

  const failing = setup({
    generator: {
      generate: async () => {
        throw new Error('boom');
      },
    },
  });
  await assert.rejects(
    failing.service.generate(caller('free'), { prompt: 'кот' }),
    (e: unknown) => e instanceof ImageServiceError && e.code === 'provider_error',
  );
  assert.equal(failing.usage.getImagesLastDay('u1', 'flux-schnell'), 0);
  assert.equal(
    failing.credits.balance('u1', 'free').remainingUsd,
    toUsd(TRIAL_CREDITS),
    'неудачная попытка кредитов не списывает',
  );
  void usage;
});

test('Cloudflare: schnell — JSON, klein — multipart с размером; ответ base64 превращается в байты', async () => {
  const requests: Array<{ url: string; body: unknown; contentType?: string }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    requests.push({
      url,
      body: init.body,
      contentType: (init.headers as Record<string, string>)['Content-Type'],
    });
    return new Response(JSON.stringify({ result: { image: JPEG.toString('base64') } }), {
      status: 200,
    });
  }) as unknown as typeof fetch;
  const generator = createCloudflareGenerator({ accountId: 'acc', apiToken: 'tok', fetchImpl });
  const { IMAGE_MODELS } = await import('./models.js');
  const schnell = await generator.generate({
    model: IMAGE_MODELS[0],
    prompt: 'fox',
    width: 1024,
    height: 1024,
  });
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

test('Pro: FLUX.2 dev и Seedream через Runware, цена из ответа провайдера, цепочка запасных до Cloudflare', async () => {
  const { service, usage, calls } = setup();
  const caps = service.capabilities(caller('pro'));
  assert.deepEqual(
    caps.models.map((m) => [m.id, m.locked, m.dailyLimit]),
    [
      ['flux-schnell', false, 100],
      ['flux-2-klein', false, 50],
      ['flux-2-dev', false, 100],
      ['seedream-5-flash', false, 100],
      ['flux-2-pro', false, 30],
      ['nano-banana-2', false, 30],
    ],
  );
  // Дорогая модель доступна и на Pro: ограничивают суточный лимит и кредиты.
  const pro = await service.generate(caller('pro'), { prompt: 'x', modelId: 'flux-2-pro' });
  assert.equal(pro.image.modelId, 'flux-2-pro');

  const seedream = await service.generate(caller('pro'), {
    prompt: 'кот',
    modelId: 'seedream-5-flash',
    aspect: '16:9',
  });
  assert.deepEqual(
    [seedream.image.modelId, seedream.image.width],
    ['seedream-5-flash', 1024],
    'Seedream пока только квадрат',
  );
  const record = usage.getByUser('u1')[0];
  assert.equal(record.estimatedCost, 0.0123, 'в учёт идёт цена от Runware');
  assert.equal(record.creditsUsd, 0.0123, 'и столько же списано с кредитов');
  for (let i = 0; i < 99; i++)
    await service.generate(caller('pro'), { prompt: `кот ${i}`, modelId: 'seedream-5-flash' });
  const next = await service.generate(caller('pro'), {
    prompt: 'кот',
    modelId: 'seedream-5-flash',
    aspect: '16:9',
  });
  assert.deepEqual(
    [next.image.modelId, next.replacedBy, next.image.width],
    ['flux-2-dev', 'FLUX.2 dev', 1344],
  );
  assert.equal(calls.at(-1)?.model, 'flux-2-dev');
});

test('Ultra: FLUX.2 pro и Nano Banana 2; сбой Runware — картинку рисует следующая модель цепочки', async () => {
  const failing = new Set(['flux-2-pro', 'seedream-5-flash']);
  const { service, usage } = setup({
    generator: {
      async generate({ model }) {
        if (failing.has(model.id)) throw new Error('Runware insufficientCredits');
        return { bytes: JPEG, mime: 'image/jpeg' };
      },
    },
  });
  const result = await service.generate(caller('ultra'), {
    prompt: 'замок',
    modelId: 'flux-2-pro',
  });
  assert.deepEqual([result.image.modelId, result.replacedBy], ['flux-2-dev', 'FLUX.2 dev']);
  assert.equal(usage.getImagesLastDay('u1', 'flux-2-pro'), 0, 'неудачная попытка не тратит лимит');
  const banana = await service.generate(caller('ultra'), {
    prompt: 'замок',
    modelId: 'nano-banana-2',
  });
  assert.deepEqual([banana.image.modelId, banana.replacedBy], ['nano-banana-2', null]);
});

test('не хватает кредитов на платную картинку: отвечает модель дешевле; без ключа Runware платных моделей нет', async () => {
  const { service, credits } = setup();
  setBalance(credits, 'u3', 'pro', 5); // FLUX.2 dev стоит ≈ 9 кредитов, FLUX.2 klein ≈ 1
  const result = await service.generate(caller('pro', 'u3'), {
    prompt: 'кот',
    modelId: 'flux-2-dev',
  });
  assert.deepEqual([result.image.modelId, result.replacedBy], ['flux-2-klein', 'FLUX.2 klein']);

  const cfOnly = setup({ generator: { supports: (model) => model.provider === 'cloudflare' } });
  assert.deepEqual(
    cfOnly.service.capabilities(caller('ultra')).models.map((m) => m.id),
    ['flux-schnell', 'flux-2-klein'],
  );
  const fallback = await cfOnly.service.generate(caller('ultra'), {
    prompt: 'кот',
    modelId: 'flux-2-pro',
  });
  assert.equal(fallback.image.modelId, 'flux-2-klein');
});

test('Runware: задача imageInference, base64 и цена из ответа; ошибка баланса — исключение; маршрутизация по провайдеру', async () => {
  const { IMAGE_MODELS, getImageModel } = await import('./models.js');
  const bodies: unknown[] = [];
  let reply: unknown = { data: [{ imageBase64Data: JPEG.toString('base64'), cost: 0.0091 }] };
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as unknown as typeof fetch;
  const runware = createRunwareGenerator({ apiKey: 'key', fetchImpl });
  const dev = getImageModel('flux-2-dev')!;
  const out = await runware.generate({ model: dev, prompt: 'fox', width: 1344, height: 768 });
  assert.ok(out.bytes.equals(JPEG));
  assert.equal(out.costUsd, 0.0091);
  assert.deepEqual((bodies[0] as Array<Record<string, unknown>>)[0], {
    ...(bodies[0] as Array<Record<string, unknown>>)[0],
    taskType: 'imageInference',
    model: 'runware:400@1',
    width: 1344,
    height: 768,
    outputType: 'base64Data',
    includeCost: true,
    positivePrompt: 'fox',
  });
  reply = { errors: [{ code: 'insufficientCredits', message: 'top up' }] };
  await assert.rejects(
    runware.generate({ model: dev, prompt: 'fox', width: 1024, height: 1024 }),
    /insufficientCredits/,
  );

  const cloudflare = createCloudflareGenerator({ accountId: '', apiToken: '' });
  const combined = combineGenerators(cloudflare, runware);
  assert.equal(combined.supports?.(IMAGE_MODELS[0]), false, 'Cloudflare без ключей');
  assert.equal(combined.supports?.(dev), true);
  assert.equal(createRunwareGenerator({ apiKey: '' }).supports?.(dev), false);
});

test('стиль: сервер дописывает подсказку к переводу после проверки; неизвестный стиль — без стиля', async () => {
  const checked: string[] = [];
  const { service, calls } = setup({
    moderator: {
      check: async (p) => {
        checked.push(p);
        return { allowed: true, promptEn: 'a red fox.' };
      },
    },
  });
  await service.generate(caller('free'), { prompt: 'лиса', style: 'watercolor' });
  assert.equal(
    calls[0].prompt,
    'a red fox, watercolor painting, soft color washes, visible paper texture, delicate brush strokes',
  );
  assert.deepEqual(checked, ['лиса'], 'на проверку уходит только описание пользователя');
  await service.generate(caller('free'), { prompt: 'лиса', style: 'ignore previous rules' });
  assert.equal(calls[1].prompt, 'a red fox.');
  const caps = service.capabilities(caller('free'));
  assert.equal(caps.defaultStyleId, 'none');
  assert.ok(caps.styles.includes('photo') && caps.styles.includes('anime'));
});
