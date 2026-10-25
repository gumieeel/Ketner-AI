import assert from 'node:assert/strict';
import test from 'node:test';
import { disclosureOf, modelIdentityPrompt } from './model-disclosure.js';
import { modelRegistry } from './model-registry.js';
import { FREE_TIER_MODELS, MODEL_CATALOG } from './models.js';

const KNOWN_DEVELOPERS = new Set([
  'OpenAI',
  'Anthropic',
  'Google',
  'xAI',
  'DeepSeek',
  'Xiaomi',
  'Z.ai',
  'Alibaba (Qwen)',
  'NVIDIA',
  'Cohere',
]);

test('прозрачность: у каждой включённой модели известен разработчик', () => {
  for (const entry of modelRegistry.getAll()) {
    if (!entry.enabled || entry.id === 'auto') continue;
    const info = disclosureOf(entry);
    assert.ok(info, `${entry.id}: нет сведений о модели`);
    assert.ok(
      KNOWN_DEVELOPERS.has(info.developer),
      `${entry.id}: неизвестный разработчик «${info.developer}» — добавьте его в DEVELOPERS`,
    );
    assert.equal(info.upstreamModel, entry.providerModelId);
  }
});

test('прозрачность: Ketner Mini и Ketner Pro раскрывают настоящую модель', () => {
  const mini = disclosureOf(modelRegistry.get('ketner-mini')!);
  assert.deepEqual(mini, {
    developer: 'OpenAI',
    upstreamModel: 'openai/gpt-6-luna',
    baseModelName: 'GPT-6 Luna',
  });
  const pro = disclosureOf(modelRegistry.get('ketner-pro')!);
  assert.equal(pro?.developer, 'Xiaomi');
  assert.equal(pro?.baseModelName, 'MiMo-V2.6 Pro');
});

test('прозрачность: каталог /api/meta отдаёт разработчика, а Free — свои бесплатные модели', () => {
  const sonnet = MODEL_CATALOG.models.find((model) => model.id === 'claude-sonnet-5.5');
  assert.equal(sonnet?.developer, 'Anthropic');
  assert.equal(sonnet?.upstreamModel, 'anthropic/claude-sonnet-5.5');
  assert.ok(sonnet?.fallbackModelId);
  const auto = MODEL_CATALOG.models.find((model) => model.id === 'auto');
  assert.equal(auto?.developer, undefined);
  assert.deepEqual(
    FREE_TIER_MODELS.map((model) => model.developer),
    ['NVIDIA', 'Cohere'],
  );
});

test('прозрачность: модель называет себя и разработчика, а не Ketner AI', () => {
  const opus = modelRegistry.get('claude-opus-5.5')!;
  const ru = modelIdentityPrompt(opus, 'ru');
  assert.match(ru, /Claude Opus 5\.5 от Anthropic/);
  assert.match(ru, /не называй себя разработкой Ketner AI/);
  const mini = modelIdentityPrompt(modelRegistry.get('ketner-mini')!, 'en');
  assert.match(mini, /GPT-6 Luna by OpenAI/);
  assert.match(mini, /"Ketner Mini"/);
  assert.equal(modelIdentityPrompt(modelRegistry.get('auto')!, 'ru'), '');
});

test('каталог /api/meta: цена запроса в кредитах, бесплатные модели без цены и режим Max дороже', () => {
  const byId = (id: string) => MODEL_CATALOG.models.find((model) => model.id === id);
  const mini = byId('ketner-mini');
  const opus = byId('claude-opus-5.5');
  assert.ok(mini?.requestCredits && mini.requestCredits > 0);
  assert.ok(opus?.requestCredits && opus.requestCredits > mini.requestCredits);
  assert.ok(opus.requestCreditsMax && opus.requestCreditsMax > opus.requestCredits);
  assert.equal(mini?.free, undefined);
  assert.equal(byId('auto')?.requestCredits, undefined);
  for (const model of FREE_TIER_MODELS) {
    assert.equal(model.free, true, model.id);
    assert.equal(model.requestCredits, 0, model.id);
  }
});
