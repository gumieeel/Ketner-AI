/**
 * СПАЙК T4.0: бот для клиентов через Mastra против прежнего пути и собственного цикла.
 * Все три идут через настоящий AIGateway с поддельным провайдером (без сети): выбор модели, запасные,
 * цена, запись учёта и списание — код шлюза.
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { AgentProviderRequest, AgentProviderResult } from '../../ai/agent/agent-types.js';
import { CircuitBreaker } from '../../ai/circuit-breaker.js';
import { AIGateway } from '../../ai/gateway.js';
import type {
  AIProvider,
  GatewayRequest,
  ProviderRequestOptions,
  ProviderResponse,
  UsageRecord,
} from '../../ai/gateway-types.js';
import { ModelRegistry } from '../../ai/model-registry.js';
import { ProviderManager } from '../../ai/providers/provider-factory.js';
import { buildBotInstructions } from '../../builder/bot-prompt.js';
import { agentSpecFromLegacy } from '../../platform/agent-spec.js';
import { memoryCredits, setBalance } from '../../services/credits-fixture.js';
import { UsageStore } from '../../store/usage-store.js';
import { assistantConfig, botSettings } from '../../testing/platform-fixtures.js';
import { botTools } from './bot-tools.js';
import type { BotAnswerOptions, BotCaller } from './gateway-step.js';
import { KetnerLanguageModel } from './ketner-language-model.js';
import { runMastraBot } from './mastra-agent.js';
import { runOwnLoop } from './own-loop.js';

const aiConfig = { thinkingMs: [0, 0], chunkMs: [0, 0], failureRate: 0, random: () => 0.5 } as const;

const QUESTION = 'Сколько стоит доставка по Алматы?';
const ANSWER = 'Доставка по Алматы — 1 500 ₸.';

interface Scenario {
  textCalls: ProviderRequestOptions[];
  agentCalls: AgentProviderRequest[];
  /** Сколько первых вызовов streamAgent падают (проверка запасных моделей). */
  failFirst: number;
}

/** Поддельный провайдер: прежний путь (streamText) и шаг агента (streamAgent). */
function fakeProvider(scenario: Scenario): AIProvider {
  let agentStep = 0;
  return {
    type: 'openrouter',
    name: 'FakeOpenRouter',
    isAvailable: () => true,
    async generateText(): Promise<ProviderResponse> {
      throw new Error('not used');
    },
    async streamText(options, callbacks): Promise<ProviderResponse> {
      scenario.textCalls.push(options);
      callbacks.onDelta?.(ANSWER);
      return {
        content: ANSWER,
        usage: { inputTokens: 150, outputTokens: 40 },
        cost: 0.00035,
        model: options.model,
        finishReason: 'stop',
      };
    },
    async streamAgent(
      request: AgentProviderRequest,
      hooks: { onEvent: (event: { kind: 'content'; text: string }) => void },
    ): Promise<AgentProviderResult> {
      scenario.agentCalls.push(request);
      if (scenario.failFirst > 0) {
        scenario.failFirst -= 1;
        throw new Error('provider down');
      }
      const hasToolResult = request.messages.some((m) => m.role === 'tool');
      if (!hasToolResult) {
        agentStep += 1;
        return {
          content: '',
          toolCalls: [
            {
              id: `call_${agentStep}`,
              type: 'function',
              function: { name: 'knowledge_search', arguments: '{"query":"доставка Алматы"}' },
            },
          ],
          finishReason: 'tool_calls',
          usage: { inputTokens: 100, outputTokens: 20 },
          cost: 0.00011,
          model: request.model,
        };
      }
      hooks.onEvent({ kind: 'content', text: ANSWER });
      return {
        content: ANSWER,
        toolCalls: [],
        finishReason: 'stop',
        usage: { inputTokens: 150, outputTokens: 40 },
        cost: 0.00035,
        model: request.model,
      };
    },
  } as AIProvider;
}

function setup(failFirst = 0) {
  const scenario: Scenario = { textCalls: [], agentCalls: [], failFirst };
  const providers = new ProviderManager();
  providers.setProvider('openrouter', fakeProvider(scenario));
  const usage = new UsageStore(join(mkdtempSync(join(tmpdir(), 'ketner-mastra-')), 'usage.json'));
  const credits = memoryCredits();
  const gateway = new AIGateway({
    registry: new ModelRegistry(),
    providers,
    usageStore: usage,
    aiConfig,
    circuitBreaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 }),
    useMockEngine: false,
    credits,
  });
  const caller: BotCaller = { userId: 'owner-1', plan: 'credits', language: 'ru' };
  setBalance(credits, caller.userId, caller.plan, 1_000);
  const config = assistantConfig({ tone: 'formal' });
  const bot = botSettings();
  const spec = agentSpecFromLegacy({ template: 'customer_bot', config, bot });
  const options: BotAnswerOptions = {
    solutionId: 'sol-1',
    instructions: buildBotInstructions(config, bot),
    conversationId: 'bot:conv-1',
    maxOutputTokens: 600,
    maxChargeUsd: 0.03,
  };
  return { scenario, usage, credits, gateway, caller, spec, options };
}

/** Прежний путь бота: тот же запрос, что builder/service.ts → answer() (без agentStep). */
async function legacyReply(env: ReturnType<typeof setup>): Promise<void> {
  const request: GatewayRequest = {
    userId: env.caller.userId,
    userPlan: env.caller.plan,
    isVip: false,
    isAnonymous: false,
    conversationId: env.options.conversationId,
    modelId: 'auto',
    messages: [{ role: 'user', content: QUESTION }],
    language: 'ru',
    stream: true,
    assistant: {
      id: env.options.solutionId,
      instructions: env.options.instructions,
      maxOutputTokens: env.options.maxOutputTokens,
      maxChargeUsd: env.options.maxChargeUsd,
      replaceSystemPrompt: true,
    },
  };
  let error: unknown = null;
  await env.gateway.stream(
    request,
    { onDelta: () => {}, onDone: () => {}, onError: (e) => (error = e) },
    () => false,
  );
  assert.equal(error, null);
}

/** Поля записи учёта, которые должны совпадать у прежнего пути и у шага агента. */
const shape = (record: UsageRecord) => ({
  userId: record.userId,
  conversationId: record.conversationId,
  modelId: record.modelId,
  provider: record.provider,
  status: record.status,
  source: record.source,
  kind: record.kind,
  runId: record.runId,
  sponsored: record.sponsored,
});

/** Подсчёт исходящих соединений: мост, Mastra и телеметрия не должны ходить в сеть. */
function countConnections() {
  const original = net.Socket.prototype.connect;
  const targets: string[] = [];
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    const first = args[0] as { host?: string; port?: number } | undefined;
    targets.push(`${first?.host ?? '?'}:${first?.port ?? '?'}`);
    return (original as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof original;
  return { targets, restore: () => (net.Socket.prototype.connect = original) };
}

test('спайк Mastra: бот с одним вызовом инструмента идёт через AIGateway, учёт как у прежнего пути', async () => {
  const net$ = countConnections();
  try {
    const legacy = setup();
    await legacyReply(legacy);
    const [legacyRecord] = legacy.usage.getByUser('owner-1');
    assert.ok(legacyRecord, 'прежний путь пишет учёт');

    const env = setup();
    const before = env.credits.balance('owner-1', 'credits').remainingUsd;
    const model = new KetnerLanguageModel(env.gateway, env.caller, env.options);
    const tools = botTools(env.spec);
    assert.deepEqual(tools.map((t) => t.name), ['knowledge_search']);
    const out = await runMastraBot(env.spec, model, tools, QUESTION);

    // Агент: один вызов инструмента и ответ по найденному.
    assert.equal(out.text, ANSWER);
    assert.deepEqual(out.toolCalls, ['knowledge_search']);
    assert.equal(env.scenario.agentCalls.length, 2, 'два шага модели: вызов инструмента и ответ');
    const toolResult = env.scenario.agentCalls[1].messages.find((m) => m.role === 'tool');
    assert.ok(toolResult && toolResult.role === 'tool' && toolResult.content.includes('1 500'));

    // Системный промпт провайдер получает от шлюза — тот же, что на прежнем пути.
    const legacySystem = legacy.scenario.textCalls[0].messages[0];
    const agentSystem = env.scenario.agentCalls[0].messages[0];
    assert.equal(agentSystem.role, 'system');
    assert.equal(legacySystem.role, 'system');
    assert.equal(agentSystem.content, legacySystem.content);
    assert.deepEqual(
      env.scenario.agentCalls[0].tools?.map((t) => t.function.name),
      ['knowledge_search'],
    );

    // Учёт: одна запись на шаг, те же поля, что у прежнего пути; цена — от провайдера.
    const records = env.usage.getByUser('owner-1').slice().reverse();
    assert.equal(records.length, 2);
    for (const record of records) assert.deepEqual(shape(record), shape(legacyRecord));
    assert.deepEqual(records.map((r) => r.estimatedCost), [0.00011, 0.00035]);
    assert.deepEqual(records.map((r) => r.creditsUsd), [0.00011, 0.00035]);
    assert.deepEqual(model.calls.map((c) => c.creditsUsd), [0.00011, 0.00035]);
    assert.equal(legacyRecord.estimatedCost, 0.00035);
    assert.equal(legacyRecord.creditsUsd, 0.00035);

    // Кредиты владельца бота уменьшились ровно на сумму двух шагов.
    const after = env.credits.balance('owner-1', 'credits').remainingUsd;
    assert.equal(Number((before - after).toFixed(6)), 0.00046);
  } finally {
    net$.restore();
  }
  assert.deepEqual(net$.targets, [], 'ни одного исходящего соединения');
});

test('спайк Mastra: собственный цикл даёт тот же результат и тот же учёт', async () => {
  const env = setup();
  const out = await runOwnLoop(env.gateway, env.caller, env.options, env.spec, botTools(env.spec), QUESTION);
  assert.equal(out.text, ANSWER);
  assert.deepEqual(out.toolCalls, ['knowledge_search']);
  assert.equal(out.steps, 2);
  assert.equal(out.stoppedBy, 'answer');
  const records = env.usage.getByUser('owner-1').slice().reverse();
  assert.deepEqual(records.map((r) => [r.kind, r.runId, r.estimatedCost, r.creditsUsd]), [
    ['assistant', 'sol-1', 0.00011, 0.00011],
    ['assistant', 'sol-1', 0.00035, 0.00035],
  ]);
});

test('спайк Mastra: при сбое провайдера шлюз переходит на запасную модель, учёт по ответившей', async () => {
  const env = setup(1);
  const model = new KetnerLanguageModel(env.gateway, env.caller, env.options);
  const out = await runMastraBot(env.spec, model, botTools(env.spec), QUESTION);
  assert.equal(out.text, ANSWER);
  const attempted = env.scenario.agentCalls.map((c) => c.model);
  assert.equal(attempted.length, 3, 'сбой, запасная модель, ответ');
  assert.notEqual(attempted[0], attempted[1], 'второй вызов — другая модель цепочки');
  const records = env.usage.getByUser('owner-1').slice().reverse();
  assert.equal(records.length, 2, 'сбой не пишет отдельной записи учёта');
  const registry = new ModelRegistry();
  assert.equal(registry.get(records[0].modelId)?.providerModelId, attempted[1]);
});

test('спайк Mastra: инструмент вне разрешённого списка агента не выполняется', async () => {
  const env = setup();
  const noKnowledge = { ...env.spec, allowedActions: ['reply.send_in_session'] };
  assert.deepEqual(botTools(noKnowledge), []);
});

test('спайк Mastra: повторы — только у шлюза (maxRetries: 0); по умолчанию Mastra прогнал бы шлюз трижды', async () => {
  for (const [maxRetries, expectedGatewayCalls] of [
    [0, 1],
    [2, 3],
  ] as const) {
    const env = setup(1_000); // все вызовы провайдера падают
    let gatewayCalls = 0;
    const original = env.gateway.stream.bind(env.gateway);
    env.gateway.stream = (async (...args: Parameters<AIGateway['stream']>) => {
      gatewayCalls += 1;
      return original(...args);
    }) as AIGateway['stream'];
    const model = new KetnerLanguageModel(env.gateway, env.caller, env.options);
    await assert.rejects(runMastraBot(env.spec, model, botTools(env.spec), QUESTION, maxRetries));
    assert.equal(gatewayCalls, expectedGatewayCalls, `maxRetries=${maxRetries}`);
    assert.equal(env.usage.getByUser('owner-1').filter((r) => (r.creditsUsd ?? 0) > 0).length, 0);
  }
});
