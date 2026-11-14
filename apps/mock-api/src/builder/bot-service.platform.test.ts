/**
 * Этап D (T4.5): все тесты bot-service.test.ts ещё раз — бот отвечает через ядро цикла агента
 * (builder/bot-agent.ts) вместо прежнего вызова builder.answer. Поведение страницы бота, деньги
 * владельца, история диалога и метка контакта должны совпасть.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { GatewayRequest, GatewayStreamCallbacks } from '../ai/gateway-types.js';
import { MemoryDiscoveryStore } from '../discovery/store.js';
import { BOT_REPLY_CAP_USD, BotService } from './bot-service.js';
import { BuilderService, defaultConfig } from './service.js';
import { MemoryBuilderStore } from './store.js';

process.env.BOT_TEST_PLATFORM = '1';
await import('./bot-service.test.js');

test('флаг выключен для решения: путь платформы не вызывается, запрос к шлюзу — прежний', async () => {
  const store = new MemoryBuilderStore();
  const now = new Date('2026-11-01T12:00:00.000Z');
  const requests: GatewayRequest[] = [];
  const gateway = {
    async stream(request: GatewayRequest, callbacks: GatewayStreamCallbacks) {
      requests.push(request);
      callbacks.onDelta('Ответ.');
      callbacks.onDone({
        inputTokens: 1,
        outputTokens: 1,
        source: 'provider',
        finishReason: 'stop',
        canContinue: false,
        selectedModel: { id: 'ketner-pro', name: 'auto' },
        costUsd: 0.002,
        creditsUsd: 0.002,
      });
    },
  };
  const builder = new BuilderService({
    store,
    discovery: new MemoryDiscoveryStore(),
    gateway,
    balanceUsd: () => 1,
    now: () => now,
  });
  let platformCalls = 0;
  const service = new BotService({
    store,
    builder,
    balanceUsd: () => 1,
    owner: () => ({ userId: 'owner-1', plan: 'free', isVip: false }),
    platform: {
      enabled: (solutionId) => solutionId === 'some-other-bot',
      answer: async () => {
        platformCalls += 1;
        throw new Error('must not be called');
      },
    },
    now: () => now,
  });
  await store.createSolution(
    {
      id: 'bot-1',
      ownerId: 'owner-1',
      type: 'customer_bot',
      template: 'customer_bot',
      bot: {
        slug: 'lisa-shop',
        greeting: '',
        quickReplies: [],
        dailyCapCredits: 1000,
        corrections: [],
      },
      status: 'active',
      name: 'Лиса',
      currentVersion: 1,
      activeVersion: 1,
      source: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      version: 1,
    },
    {
      solutionId: 'bot-1',
      number: 1,
      config: defaultConfig('Лиса', 'ru'),
      createdAt: now.toISOString(),
    },
    [],
  );
  const sent = await service.send('lisa-shop', {
    visitorId: 'v_visitor0000001',
    content: 'Привет',
  });
  assert.ok(sent.ok);
  assert.equal(platformCalls, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.agentStep, undefined, 'прежний путь: без шага агента');
  assert.equal(requests[0]!.assistant?.maxChargeUsd, BOT_REPLY_CAP_USD);
  assert.ok(
    !requests[0]!.assistant?.instructions.includes('knowledge_search'),
    'промпт без дописки инструментов',
  );
});
