/**
 * Кем называет себя модель. Бот для клиентов (прежний путь и путь платформы): роль из промпта бота,
 * модель — только на прямой вопрос. Чат Ketner: прежняя строка о модели без изменений. Настоящий
 * AIGateway и BotService, поддельный провайдер без сети: проверяется системный промпт запроса.
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { AgentProviderRequest, AgentProviderResult } from './agent/agent-types.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { AIGateway } from './gateway.js';
import type {
  AIProvider,
  GatewayRequest,
  ProviderRequestOptions,
  ProviderResponse,
} from './gateway-types.js';
import { modelDisclosureOnRequestPrompt, modelIdentityPrompt } from './model-disclosure.js';
import { ModelRegistry } from './model-registry.js';
import { ProviderManager } from './providers/provider-factory.js';
import { BotAgentRuntime } from '../builder/bot-agent.js';
import { BotService } from '../builder/bot-service.js';
import { BuilderService, defaultConfig } from '../builder/service.js';
import { MemoryBuilderStore } from '../builder/store.js';
import { MemoryDiscoveryStore } from '../discovery/store.js';
import { MemoryExecutionJournal } from '../platform/journal.js';
import { memoryCredits, setBalance } from '../services/credits-fixture.js';
import { UsageStore } from '../store/usage-store.js';

const OWNER = 'owner-identity';
const registry = new ModelRegistry();

function setup() {
  const text: ProviderRequestOptions[] = [];
  const agent: AgentProviderRequest[] = [];
  const provider = {
    type: 'openrouter' as const,
    name: 'Fake',
    isAvailable: () => true,
    async generateText(): Promise<ProviderResponse> {
      throw new Error('not used');
    },
    async streamText(options: ProviderRequestOptions, cb: { onDelta?: (d: string) => void }) {
      text.push(options);
      cb.onDelta?.('Я ИИ-ассистент студии.');
      return {
        content: 'Я ИИ-ассистент студии.',
        usage: { inputTokens: 50, outputTokens: 10 },
        cost: 0.0002,
        model: options.model,
        finishReason: 'stop' as const,
      };
    },
    async streamAgent(request: AgentProviderRequest, hooks: { onEvent: (e: never) => void }) {
      agent.push(request);
      (hooks.onEvent as (e: { kind: 'content'; text: string }) => void)({
        kind: 'content',
        text: 'Я ИИ-ассистент студии.',
      });
      return {
        content: 'Я ИИ-ассистент студии.',
        toolCalls: [],
        finishReason: 'stop',
        usage: { inputTokens: 50, outputTokens: 10 },
        cost: 0.0002,
        model: request.model,
      } satisfies AgentProviderResult;
    },
  } as unknown as AIProvider;
  const providers = new ProviderManager();
  providers.setProvider('openrouter', provider);
  const credits = memoryCredits();
  setBalance(credits, OWNER, 'credits', 1_000);
  const gateway = new AIGateway({
    registry,
    providers,
    usageStore: new UsageStore(join(mkdtempSync(join(tmpdir(), 'ketner-identity-')), 'u.json')),
    aiConfig: { thinkingMs: [0, 0], chunkMs: [0, 0], failureRate: 0, random: () => 0.5 },
    circuitBreaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 }),
    useMockEngine: false,
    credits,
  });
  return { gateway, text, agent };
}

/** Модель реестра, которой шлюз отправил запрос (по идентификатору движка). */
function entryOf(engine: string) {
  const entry = registry
    .getAllIncludingDisabled()
    .find((model) => model.providerModelId === engine || model.id === engine);
  assert.ok(entry, `модель ${engine} есть в реестре`);
  return entry!;
}

const systemOf = (messages: Array<{ role: string; content: unknown }>) => {
  const system = messages.find((m) => m.role === 'system');
  assert.ok(system, 'есть системный промпт');
  return String(system!.content);
};

async function botService(platform: boolean) {
  const env = setup();
  const store = new MemoryBuilderStore();
  const now = new Date('2026-11-14T12:00:00.000Z');
  const builder = new BuilderService({
    store,
    discovery: new MemoryDiscoveryStore(),
    gateway: env.gateway,
    balanceUsd: () => 1,
    now: () => now,
  });
  const runtime = new BotAgentRuntime({
    gateway: env.gateway,
    journal: new MemoryExecutionJournal(),
  });
  const service = new BotService({
    store,
    builder,
    balanceUsd: () => 1,
    owner: () => ({ userId: OWNER, plan: 'credits', isVip: false }),
    ...(platform
      ? { platform: { enabled: () => true, answer: (input) => runtime.answer(input) } }
      : {}),
    now: () => now,
  });
  await store.createSolution(
    {
      id: 'bot-k',
      ownerId: OWNER,
      type: 'customer_bot',
      template: 'customer_bot',
      bot: {
        slug: 'keramika-studio',
        greeting: '',
        quickReplies: [],
        dailyCapCredits: 1000,
        corrections: [],
      },
      status: 'active',
      name: 'Керамика',
      currentVersion: 1,
      activeVersion: 1,
      source: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      version: 1,
    },
    {
      solutionId: 'bot-k',
      number: 1,
      config: { ...defaultConfig('Керамика', 'ru'), knowledge: 'Мастер-класс — 12 000 ₸.' },
      createdAt: now.toISOString(),
    },
    [],
  );
  return { ...env, service };
}

const ROLE = 'Ты — ИИ-ассистент «Керамика» для его клиентов.';
const WHO_RULE =
  /Кто ты: на вопрос «кто ты» или «ты бот\?» отвечай своей ролью — ты ИИ-ассистент «Керамика»/;
const NEVER_DENY = 'Никогда не отрицай, что ты ИИ, и не выдавай себя за человека.';

function assertBotIdentity(system: string, engine: string) {
  const entry = entryOf(engine);
  assert.ok(system.includes(ROLE), 'роль из промпта бота');
  assert.match(system, WHO_RULE);
  assert.ok(system.includes(NEVER_DENY), 'не отрицает, что он ИИ');
  const disclosure = modelDisclosureOnRequestPrompt(entry, 'ru');
  assert.ok(disclosure.length > 0);
  assert.ok(system.endsWith(disclosure), 'правило: модель — только на прямой вопрос, и честно');
  assert.match(disclosure, /Если собеседник прямо спрашивает, на какой модели ИИ ты работаешь/);
  assert.match(disclosure, /ответь честно/);
  // Строки чата о модели в промпте бота нет: она перебивала роль бота.
  assert.ok(!system.includes(modelIdentityPrompt(entry, 'ru')));
  assert.ok(!system.includes('Ты — модель'));
  assert.ok(!system.includes('называется «'), 'название тарифа Ketner боту не подсказывается');
  // Не велено лгать или отказываться.
  assert.doesNotMatch(system, /не (говори|раскрывай|признавайся)[^.]*модел/i);
  assert.doesNotMatch(system, /(?<!никогда не )(отрицай|скрывай), что ты ИИ/i);
  assert.doesNotMatch(system, /(не признавайся|не говори), что ты (ИИ|бот)/i);
}

test('бот, прежний путь: роль из промпта бота и раскрытие модели только по прямому вопросу', async () => {
  const env = await botService(false);
  const sent = await env.service.send('keramika-studio', {
    visitorId: 'v_visitor0000001',
    content: 'ты кто',
  });
  assert.ok(sent.ok);
  assert.equal(env.agent.length, 0, 'прежний путь: без шага агента');
  assert.equal(env.text.length, 1);
  assertBotIdentity(systemOf(env.text[0]!.messages), env.text[0]!.model);
});

test('бот, путь платформы: та же роль и то же правило в запросе шага агента', async () => {
  const env = await botService(true);
  const sent = await env.service.send('keramika-studio', {
    visitorId: 'v_visitor0000001',
    content: 'ты кто',
  });
  assert.ok(sent.ok);
  assert.equal(env.text.length, 0, 'путь платформы: шаг агента');
  assert.equal(env.agent.length, 1);
  const system = systemOf(env.agent[0]!.messages);
  assertBotIdentity(system, env.agent[0]!.model);
  assert.ok(system.includes('offer_contact'), 'инструкции инструментов на месте');
});

test('кэш промпта: системный промпт бота байт-в-байт одинаков на разных вопросах и диалогах', async () => {
  for (const platform of [false, true]) {
    const env = await botService(platform);
    const questions = ['ты кто', 'Сколько стоит мастер-класс?', 'Вы работаете в воскресенье?'];
    for (const [n, content] of questions.entries()) {
      const sent = await env.service.send('keramika-studio', {
        visitorId: `v_visitor000000${n}`,
        content,
      });
      assert.ok(sent.ok);
    }
    const requests = platform ? env.agent : env.text;
    assert.equal(requests.length, questions.length);
    const prompts = new Set(requests.map((r) => systemOf(r.messages)));
    const engines = new Set(requests.map((r) => r.model));
    // Строка о модели постоянна для модели и языка: на одной модели префикс не меняется.
    assert.equal(prompts.size, engines.size, platform ? 'путь платформы' : 'прежний путь');
    for (const request of requests) {
      assert.ok(
        !systemOf(request.messages).includes('мастер-класс?'),
        'вопрос не в системном промпте',
      );
    }
  }
});

test('чат Ketner и помощник Builder: прежняя строка о модели без изменений', async () => {
  const env = setup();
  const base: GatewayRequest = {
    userId: OWNER,
    userPlan: 'credits',
    isVip: false,
    isAnonymous: false,
    conversationId: 'chat-1',
    modelId: 'auto',
    messages: [{ role: 'user', content: 'ты кто' }],
    language: 'ru',
    stream: true,
  };
  const done = (request: GatewayRequest) =>
    new Promise<void>((resolve, reject) => {
      void env.gateway.stream(
        request,
        {
          onDelta: () => {},
          onDone: () => resolve(),
          onError: (error) => reject(new Error(error.message)),
        },
        () => false,
      );
    });
  await done(base);
  await done({
    ...base,
    conversationId: 'assistant-1',
    assistant: { id: 'sol-assistant', instructions: 'Ты помощник по письмам.' },
  });
  assert.equal(env.text.length, 2);
  for (const request of env.text) {
    const entry = entryOf(request.model);
    const system = systemOf(request.messages);
    assert.ok(
      system.endsWith(modelIdentityPrompt(entry, 'ru')),
      'строка чата о модели — как раньше',
    );
    assert.ok(!system.includes('Если собеседник прямо спрашивает'));
  }
  // Сама строка чата не менялась (эталон для модели с собственным названием Ketner).
  assert.equal(
    modelIdentityPrompt({ providerModelId: 'openai/gpt-6-luna', name: 'Ketner Mini' }, 'ru'),
    ' Ты — модель GPT-6 Luna от OpenAI (в Ketner AI называется «Ketner Mini»), доступная через сервис Ketner AI. Если спрашивают, какая ты модель или кто тебя создал, отвечай честно и не называй себя разработкой Ketner AI.',
  );
  // Боту — без названия тарифа Ketner, но с настоящей моделью и разработчиком.
  assert.equal(
    modelDisclosureOnRequestPrompt(
      { providerModelId: 'openai/gpt-6-luna', name: 'Ketner Mini' },
      'ru',
    ),
    ' Если собеседник прямо спрашивает, на какой модели ИИ ты работаешь или какая компания её создала, ответь честно: ты работаешь на модели GPT-6 Luna от OpenAI, а бот работает на сервисе Ketner AI. Сам об этом не заговаривай.',
  );
  assert.equal(
    modelDisclosureOnRequestPrompt(
      { providerModelId: 'openai/gpt-6-luna', name: 'Ketner Mini' },
      'en',
    ),
    ' If the visitor asks directly which AI model you run on or which company made it, answer truthfully: you run on GPT-6 Luna by OpenAI, and the bot works on the Ketner AI service. Do not bring this up yourself.',
  );
});

test('прогон тестов решения: у бота — тот же промпт бота с ролью, у помощника — правила чата', async () => {
  const { answerInstructions } = await import('../builder/service.js');
  const config = defaultConfig('Керамика', 'ru');
  const bot = {
    slug: 'keramika-studio',
    greeting: '',
    quickReplies: [],
    dailyCapCredits: 1000,
    corrections: [],
  };
  // executeRun берёт промпт и флаг отсюда же: шлюз даёт боту правило «модель — по прямому вопросу».
  const forBot = answerInstructions(config, bot);
  assert.equal(forBot.replaceSystemPrompt, true);
  assert.ok(forBot.instructions.includes(ROLE));
  assert.match(forBot.instructions, WHO_RULE);
  const forAssistant = answerInstructions(config, null);
  assert.equal(
    forAssistant.replaceSystemPrompt,
    false,
    'помощник Builder — в чате Ketner, строка чата',
  );
  assert.ok(!forAssistant.instructions.includes(ROLE));
});
