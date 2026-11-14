/**
 * Семантический кэш ответов выключен (ai/cache.ts → SEMANTIC_CACHE_ENABLED): чат всегда спрашивает
 * модель, файл кэша не создаётся, файл прежнего кэша удаляется при старте, старые записи учёта с
 * `source: 'cache'` по-прежнему читаются.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  LEGACY_SEMANTIC_CACHE_FILE,
  removeLegacySemanticCacheFile,
  SEMANTIC_CACHE_ENABLED,
  semanticCache,
} from './cache.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { AIGateway } from './gateway.js';
import type {
  AIProvider,
  GatewayDoneResult,
  GatewayRequest,
  ProviderRequestOptions,
  ProviderResponse,
} from './gateway-types.js';
import { ModelRegistry } from './model-registry.js';
import { ProviderManager } from './providers/provider-factory.js';
import { memoryCredits } from '../services/credits-fixture.js';
import { UsageStore } from '../store/usage-store.js';

function setup() {
  const calls: ProviderRequestOptions[] = [];
  const provider = {
    type: 'openrouter' as const,
    name: 'Fake',
    isAvailable: () => true,
    async generateText(): Promise<ProviderResponse> {
      throw new Error('not used');
    },
    async streamText(options: ProviderRequestOptions, cb: { onDelta?: (d: string) => void }) {
      calls.push(options);
      const text = `Ответ модели номер ${calls.length}: столица Франции — Париж.`;
      cb.onDelta?.(text);
      return {
        content: text,
        usage: { inputTokens: 40, outputTokens: 12 },
        cost: 0.0001,
        model: options.model,
        finishReason: 'stop' as const,
      };
    },
  } as unknown as AIProvider;
  const providers = new ProviderManager();
  providers.setProvider('openrouter', provider);
  const usage = new UsageStore(join(mkdtempSync(join(tmpdir(), 'ketner-nocache-')), 'u.json'));
  const gateway = new AIGateway({
    registry: new ModelRegistry(),
    providers,
    usageStore: usage,
    aiConfig: { thinkingMs: [0, 0], chunkMs: [0, 0], failureRate: 0, random: () => 0.5 },
    circuitBreaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 }),
    useMockEngine: false,
    credits: memoryCredits(),
  });
  return { gateway, calls, usage };
}

function ask(gateway: AIGateway, userId: string, conversationId: string, content: string) {
  const request: GatewayRequest = {
    userId,
    userPlan: 'free',
    isVip: false,
    isAnonymous: false,
    conversationId,
    modelId: 'auto',
    messages: [{ role: 'user', content }],
    language: 'ru',
    stream: true,
  };
  return new Promise<{ text: string; done: GatewayDoneResult }>((done, fail) => {
    let text = '';
    void gateway.stream(
      request,
      {
        onDelta: (delta) => {
          text += delta;
        },
        onDone: (result) => done({ text, done: result }),
        onError: (error) => fail(new Error(error.message)),
      },
      () => false,
    );
  });
}

test('кэш выключен: одинаковый вопрос двух бесплатных пользователей — оба раза ответ модели', async () => {
  assert.equal(SEMANTIC_CACHE_ENABLED, false);
  const legacy = resolve(LEGACY_SEMANTIC_CACHE_FILE);
  removeLegacySemanticCacheFile(legacy);
  const { gateway, calls, usage } = setup();
  const question = 'Какая столица Франции?';

  const first = await ask(gateway, 'free-user-a', 'chat-a', question);
  const second = await ask(gateway, 'free-user-b', 'chat-b', question);
  const again = await ask(gateway, 'free-user-a', 'chat-a2', question);

  assert.equal(calls.length, 3, 'каждый запрос дошёл до провайдера');
  assert.notEqual(first.text, second.text, 'второй пользователь получил свой ответ, а не чужой');
  for (const result of [first, second, again]) {
    assert.equal(result.done.source, 'provider');
    assert.ok(!String(result.done.routingReason ?? '').includes('Cache'));
  }
  const records = [...usage.getByUser('free-user-a'), ...usage.getByUser('free-user-b')];
  assert.equal(records.length, 3);
  assert.ok(records.every((record) => record.source === 'provider'));
  assert.equal(semanticCache.getStats().size, 0, 'в кэш ничего не записано');
  assert.equal(existsSync(legacy), false, 'файл кэша не создан');
  assert.equal(existsSync(`${legacy}.tmp`), false);
});

test('старт сервера: файл прежнего кэша и его временная копия удаляются; повтор — без ошибок', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ketner-legacy-cache-'));
  const file = join(dir, 'semantic-cache.json');
  writeFileSync(file, JSON.stringify([{ key: 'shared:m:ru:x:вопрос', response: 'личный ответ' }]));
  writeFileSync(`${file}.tmp`, '[]');
  assert.deepEqual(removeLegacySemanticCacheFile(file), [file, `${file}.tmp`]);
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(`${file}.tmp`), false);
  assert.deepEqual(removeLegacySemanticCacheFile(file), [], 'файла нет — ничего не делает');
});

test('учёт: старые записи с source cache загружаются и видны в метриках', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'ketner-usage-cache-')), 'usage.json');
  const first = new UsageStore(file);
  for (const source of ['provider', 'cache', 'cache'] as const) {
    first.recordUsage({
      userId: 'u1',
      conversationId: 'c1',
      modelId: 'ketner-mini',
      provider: 'openrouter',
      inputTokens: 100,
      outputTokens: 20,
      estimatedCost: source === 'cache' ? 0 : 0.001,
      latencyMs: 10,
      ttftMs: 5,
      status: 'success',
      source,
    });
  }
  const reloaded = new UsageStore(file);
  assert.deepEqual(
    reloaded
      .getByUser('u1')
      .map((record) => record.source)
      .sort(),
    ['cache', 'cache', 'provider'],
  );
  const metrics = reloaded.getGatewayMetrics();
  assert.equal(metrics.cacheHits, 2);
  assert.equal(metrics.costBySource.cache.requests, 2);
  assert.equal(metrics.costBySource.provider.requests, 1);
});
