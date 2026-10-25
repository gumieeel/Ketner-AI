import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {
  AIProvider,
  ChatCompletionCallbacks,
  ChatCompletionOptions,
  ChatCompletionResult,
  ChatWireMessage,
} from '../ai/gateway-types.js';
import { CircuitBreaker } from '../ai/circuit-breaker.js';
import { OpenRouterError } from '../ai/providers/openrouter-provider.js';
import { ProviderManager } from '../ai/providers/provider-factory.js';
import type { PlanId } from '../types.js';
import { UsageStore } from '../store/usage-store.js';
import {
  AgentRunner,
  compactMessages,
  selectAgentModel,
  type AgentEvent,
  type AgentRunInput,
} from './agent-runner.js';
import { ProjectStore } from './project-store.js';
import { getCodeLimits, quotaOf } from '../services/code-limits.js';
import { modelRegistry } from '../ai/model-registry.js';
import type { CreditService } from '../services/credits.js';
import { memoryCredits, setBalance } from '../services/credits-fixture.js';

interface Call {
  model: string;
  messages: ChatWireMessage[];
  toolNames: string[];
  index: number;
}
type Script = (
  call: Call,
  options: ChatCompletionOptions,
  callbacks: ChatCompletionCallbacks,
) => ChatCompletionResult | Promise<ChatCompletionResult>;

let callCounter = 0;
const toolStep = (calls: Array<[string, unknown]>, cost = 0.001): ChatCompletionResult => ({
  content: '',
  toolCalls: calls.map(([name, args]) => ({
    id: `call_${(callCounter += 1)}`,
    name,
    arguments: typeof args === 'string' ? args : JSON.stringify(args),
  })),
  usage: { inputTokens: 1_000, outputTokens: 100 },
  cost,
  finishReason: 'tool_calls',
});
const finalStep = (text: string, cost = 0.001): ChatCompletionResult => ({
  content: text,
  toolCalls: [],
  usage: { inputTokens: 1_200, outputTokens: 60 },
  cost,
  finishReason: 'stop',
});

function fakeProvider(script: Script): { provider: AIProvider; calls: Call[] } {
  const calls: Call[] = [];
  const provider: AIProvider = {
    type: 'openrouter',
    name: 'fake',
    isAvailable: () => true,
    generateText: async () => {
      throw new Error('not used');
    },
    streamText: async () => {
      throw new Error('not used');
    },
    streamChat: async (options, callbacks) => {
      const call: Call = {
        model: options.model,
        messages: [...options.messages],
        toolNames: (options.tools ?? []).map((tool) => tool.function.name),
        index: calls.length,
      };
      calls.push(call);
      const scripted = await script(call, options, callbacks);
      // OpenRouter не берёт денег за :free-эндпоинты и сообщает нулевую цену.
      const result = options.model.endsWith(':free') ? { ...scripted, cost: 0 } : scripted;
      if (result.content) callbacks.onDelta(result.content);
      return result;
    },
  };
  return { provider, calls };
}

interface Harness {
  runner: AgentRunner;
  store: ProjectStore;
  usage: UsageStore;
  credits: CreditService;
  projectId: string;
  calls: Call[];
  run: (
    task: string,
    overrides?: Partial<AgentRunInput>,
  ) => Promise<{ events: AgentEvent[]; result: Awaited<ReturnType<AgentRunner['run']>> }>;
}

async function withHarness(
  script: Script,
  run: (h: Harness) => Promise<void>,
  options: {
    plan?: PlanId;
    /** Кредиты пользователя на старте; по умолчанию — полная месячная выдача тарифа. */
    credits?: number;
    watchdog?: { firstTokenMs: number; idleMs: number; totalMs: number };
  } = {},
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ketner-agent-'));
  try {
    const plan = options.plan ?? 'pro';
    const store = new ProjectStore({ rootDir: path.join(dir, 'projects') });
    const meta = await store.create(
      'u1',
      { name: 'Demo' },
      { maxProjects: 5, quota: quotaOf(getCodeLimits(plan)) },
    );
    const usage = new UsageStore(path.join(dir, 'usage.json'));
    const credits = memoryCredits();
    if (options.credits !== undefined) setBalance(credits, 'u1', plan, options.credits);
    const providers = new ProviderManager();
    const { provider, calls } = fakeProvider(script);
    providers.setProvider('openrouter', provider);
    const runner = new AgentRunner({
      store,
      usageStore: usage,
      sandbox: null,
      providers,
      circuitBreaker: new CircuitBreaker(),
      watchdog: options.watchdog,
      credits,
    });
    await run({
      runner,
      store,
      usage,
      credits,
      projectId: meta.id,
      calls,
      run: async (task, overrides = {}) => {
        const events: AgentEvent[] = [];
        const result = await runner.run(
          {
            userId: 'u1',
            plan,
            projectId: meta.id,
            task,
            language: 'en',
            signal: new AbortController().signal,
            ...overrides,
          },
          (event) => events.push(event),
        );
        return { events, result };
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const types = (events: AgentEvent[]): string[] => events.map((e) => e.type);

test('полный запуск: инструменты меняют проект, лента и учёт расходов записаны', () =>
  withHarness(
    (call) => {
      if (call.index === 0) {
        return toolStep([
          ['write_file', { path: 'src/hello.js', content: 'console.log("hi");\n' }],
          ['list_files', {}],
        ]);
      }
      if (call.index === 1) {
        return toolStep([
          ['edit_file', { path: 'src/hello.js', old_string: '"hi"', new_string: '"hello"' }],
        ]);
      }
      return finalStep('Done: created src/hello.js.');
    },
    async (h) => {
      const { events, result } = await h.run('Create hello.js');
      assert.equal(result.status, 'completed');
      assert.equal(result.steps, 3);
      assert.equal(types(events)[0], 'run_start');
      assert.equal(types(events).at(-1), 'done');
      assert.ok(
        events.some(
          (e) =>
            e.type === 'tool_result' && e.tool === 'write_file' && e.change?.action === 'create',
        ),
      );
      assert.ok(events.some((e) => e.type === 'delta' && e.content.includes('Done')));

      assert.equal(
        (await h.store.readText('u1', h.projectId, 'src/hello.js')).content,
        'console.log("hello");\n',
      );

      // системный промпт: проект, список файлов и все инструменты, кроме команд (песочницы нет)
      const first = h.calls[0];
      assert.equal(first.messages[0].role, 'system');
      assert.match(first.messages[0].content, /Project: Demo/);
      assert.match(first.messages[0].content, /README\.md/);
      assert.ok(first.toolNames.includes('edit_file'));
      assert.ok(!first.toolNames.includes('run_command'));
      // результаты инструментов возвращаются модели
      assert.ok(
        h.calls[1].messages.some(
          (m) => m.role === 'tool' && m.content.includes('Created src/hello.js'),
        ),
      );

      // лента сохранена
      const thread = await h.store.getThread('u1', h.projectId);
      assert.deepEqual(
        thread.map((item) => item.kind),
        ['user', 'tool', 'tool', 'tool', 'assistant', 'run'],
      );

      // учёт: шаг 0 + три шага, не считаются сообщениями чата
      const records = h.usage.getByUser('u1', 50).filter((r) => r.kind === 'agent');
      assert.equal(records.length, 4);
      assert.deepEqual(records.map((r) => r.step).sort(), [0, 1, 2, 3]);
      assert.ok(records.every((r) => r.runId === result.runId));
      assert.ok(Math.abs(records.reduce((sum, r) => sum + r.estimatedCost, 0) - 0.003) < 1e-9);
      const snapshot = h.usage.getFairUseSnapshot('u1');
      assert.equal(snapshot.requestsLastDay, 0);
      assert.equal(h.usage.getAgentRunsLastDay('u1'), 1);
      assert.equal(h.usage.getActiveConcurrency('u1'), 0);
    },
  ));

test('следующий запуск видит прошлые сообщения, но не результаты инструментов', () =>
  withHarness(
    (call) => finalStep(`answer ${call.index}`),
    async (h) => {
      await h.run('first task');
      await h.run('second task');
      const second = h.calls[1].messages.filter((m) => m.role !== 'system');
      assert.deepEqual(
        second.map((m) => [m.role, m.content]),
        [
          ['user', 'first task'],
          ['assistant', 'answer 0'],
          ['user', 'second task'],
        ],
      );
    },
  ));

test('лимит запусков в сутки по тарифу', () =>
  withHarness(
    () => finalStep('ok', 0.0005),
    async (h) => {
      for (let i = 0; i < 3; i += 1)
        assert.equal((await h.run(`task ${i}`)).result.status, 'completed');
      const { events, result } = await h.run('one too many');
      assert.equal(result.status, 'rejected');
      assert.deepEqual(events, [
        {
          type: 'error',
          code: 'run_limit',
          message: events[0].type === 'error' ? events[0].message : '',
        },
      ]);
      assert.equal(h.calls.length, 3, 'модель не вызывалась');
    },
    { plan: 'free' },
  ));

test('Free: агент работает на бесплатной модели с первого шага, кредиты не тратятся, ограничивают только шаги', () =>
  withHarness(
    (call) => toolStep([['write_file', { path: `f${call.index}.txt`, content: 'x' }]], 0.05),
    async (h) => {
      const before = h.credits.balance('u1', 'free').remainingUsd;
      const { events, result } = await h.run('write many files');
      assert.equal(h.calls[0].model, 'cohere/north-mini-code:free');
      assert.equal(result.status, 'step_limit');
      assert.equal(result.modelId, 'north-mini-code');
      assert.equal(result.costUsd, 0, 'бесплатная модель ничего не стоит');
      assert.equal(h.credits.balance('u1', 'free').remainingUsd, before);
      assert.ok((await h.store.listFiles('u1', h.projectId)).some((f) => f.path === 'f0.txt'));
      assert.equal(events.at(-1)?.type, 'done');
    },
    { plan: 'free' },
  ));

test('бюджет запуска исчерпан: агент молча переходит на модель дешевле, правки сохранены', () =>
  withHarness(
    (call) =>
      call.index === 0
        ? toolStep([['write_file', { path: 'a.txt', content: 'x' }]], 0.5)
        : finalStep('готово', 0.001),
    async (h) => {
      const { events, result } = await h.run('task');
      // Шаг на Ketner Pro стоит $0.5 при бюджете запуска Plus $0.1: дальше работает модель дешевле.
      assert.equal(h.calls[0].model, 'xiaomi/mimo-v2.6-pro');
      assert.notEqual(h.calls[1].model, 'xiaomi/mimo-v2.6-pro');
      assert.ok(events.some((e) => e.type === 'model_switch'));
      assert.ok(!events.some((e) => e.type === 'error'), 'ошибки пользователь не видит');
      assert.equal(result.status, 'completed');
      assert.ok((await h.store.listFiles('u1', h.projectId)).some((f) => f.path === 'a.txt'));
    },
    { plan: 'plus' },
  ));

test('остановка по числу шагов: лёгкая модель получает добавочные шаги, но не больше двойного лимита', () =>
  withHarness(
    () => toolStep([['list_files', {}]], 0.0001),
    async (h) => {
      const { result } = await h.run('loop forever');
      assert.equal(result.status, 'step_limit');
      assert.equal(result.steps, getCodeLimits('free').maxSteps * 2);
      assert.equal(h.calls.length, getCodeLimits('free').maxSteps * 2);
    },
    { plan: 'free' },
  ));

test('отмена клиентом: правки сохранены, статус cancelled, слот освобождён', () =>
  withHarness(
    (call) => {
      if (call.index === 0) return toolStep([['write_file', { path: 'a.txt', content: 'a' }]]);
      controller.abort();
      return {
        content: '',
        toolCalls: [],
        usage: { inputTokens: 500, outputTokens: 0 },
        finishReason: 'cancelled',
      };
    },
    async (h) => {
      const { result } = await h.run('start and stop', { signal: controller.signal });
      assert.equal(result.status, 'cancelled');
      assert.ok((await h.store.listFiles('u1', h.projectId)).some((f) => f.path === 'a.txt'));
      assert.equal(h.usage.getActiveConcurrency('u1'), 0);
      const thread = await h.store.getThread('u1', h.projectId);
      assert.equal(thread.at(-1)?.kind, 'run');
    },
  ));
const controller = new AbortController();

test('модель без поддержки инструментов заменяется следующей в цепочке', () =>
  withHarness(
    (call) => {
      if (call.index === 0)
        throw new OpenRouterError(call.model, 404, 'No endpoints found that support tool use');
      return finalStep('worked on the fallback');
    },
    async (h) => {
      const { events, result } = await h.run('anything');
      assert.equal(result.status, 'completed');
      assert.equal(h.calls[0].model, 'xiaomi/mimo-v2.6-pro');
      assert.equal(h.calls[1].model, 'anthropic/claude-haiku-5.5');
      assert.ok(events.some((e) => e.type === 'model_switch' && e.modelId === 'claude-haiku-5.5'));
      assert.equal(result.modelId, 'claude-haiku-5.5');
    },
  ));

test('отказ ключа OpenRouter (402) завершает запуск ошибкой без перебора цепочки', () =>
  withHarness(
    (call) => {
      throw new OpenRouterError(call.model, 402, 'insufficient credits');
    },
    async (h) => {
      const { events, result } = await h.run('anything');
      assert.equal(result.status, 'error');
      assert.equal(h.calls.length, 1);
      const last = events.at(-1);
      assert.ok(last?.type === 'error' && last.code === 'provider_error');
      assert.doesNotMatch(JSON.stringify(last), /credits|openrouter/i);
      assert.equal(h.usage.getActiveConcurrency('u1'), 0);
    },
  ));

test('недоступная по тарифу модель отклоняется до обращения к провайдеру', () =>
  withHarness(
    () => finalStep('no'),
    async (h) => {
      const { events, result } = await h.run('use opus', { modelId: 'claude-opus-5.5' });
      assert.equal(result.status, 'rejected');
      assert.ok(events[0].type === 'error' && events[0].code === 'upgrade_required');
      assert.equal(h.calls.length, 0);
    },
    { plan: 'free' },
  ));

test('явно выбранная доступная модель используется как есть', () =>
  withHarness(
    () => finalStep('sol here'),
    async (h) => {
      const { result } = await h.run('hello', { modelId: 'gpt-6.1-sol' });
      assert.equal(result.status, 'completed');
      assert.equal(h.calls[0].model, 'openai/gpt-6.1-sol');
    },
  ));

test('агент застревает на одинаковых ошибках: остановка с пояснением', () =>
  withHarness(
    (call) => toolStep([['read_file', { path: `missing-${call.index}.txt` }]], 0.0005),
    async (h) => {
      const { result, events } = await h.run('read things');
      assert.equal(result.status, 'error');
      assert.equal(result.steps, 6);
      const done = events.at(-1);
      assert.ok(done?.type === 'done' && done.message);
    },
  ));

test('оборванный ответ (length) продолжается подсказкой, а повтор завершает запуск', () =>
  withHarness(
    () => ({
      content: 'half of an ans',
      toolCalls: [],
      usage: { inputTokens: 100, outputTokens: 4096 },
      cost: 0.001,
      finishReason: 'length',
    }),
    async (h) => {
      const { result } = await h.run('big task');
      assert.equal(result.status, 'length');
      assert.equal(h.calls.length, 2);
      assert.ok(h.calls[1].messages.some((m) => m.role === 'user' && /cut off/.test(m.content)));
    },
  ));

test('зависший поток обрывается сторожем и берётся запасная модель', () =>
  withHarness(
    async (call, options) => {
      if (call.index === 0) {
        await new Promise<void>((resolve) =>
          options.signal?.addEventListener('abort', () => resolve(), { once: true }),
        );
        return {
          content: '',
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: 'cancelled',
        };
      }
      return finalStep('recovered');
    },
    async (h) => {
      const { result } = await h.run('hang');
      assert.equal(result.status, 'completed');
      assert.equal(result.modelId, 'claude-haiku-5.5');
    },
    { watchdog: { firstTokenMs: 150, idleMs: 150, totalMs: 1_000 } },
  ));

test('инструкции проекта (AGENTS.md) попадают в системный промпт, а секреты — нет', () =>
  withHarness(
    () => finalStep('ok'),
    async (h) => {
      await h.store.writeText(
        'u1',
        h.projectId,
        'AGENTS.md',
        'Use tabs. Run npm test.',
        quotaOf(getCodeLimits('pro')),
      );
      await h.store.writeText(
        'u1',
        h.projectId,
        '.env',
        'API_KEY=topsecret',
        quotaOf(getCodeLimits('pro')),
      );
      await h.run('hi');
      const system = h.calls[0].messages[0].content;
      assert.match(system, /Use tabs/);
      assert.doesNotMatch(system, /topsecret|API_KEY/);
      assert.doesNotMatch(system, /^\.env$/m, 'секретный файл не показывается в списке файлов');
    },
  ));

test('задача проверяется: пустая и слишком длинная', () =>
  withHarness(
    () => finalStep('ok'),
    async (h) => {
      assert.equal((await h.run('   ')).result.status, 'rejected');
      const long = await h.run('x'.repeat(getCodeLimits('pro').maxTaskChars + 1));
      assert.equal(long.result.status, 'rejected');
      assert.equal(
        (await h.run('hi', { projectId: 'does-not-exist-123' })).result.status,
        'rejected',
      );
      assert.equal(h.calls.length, 0);
    },
  ));

test('selectAgentModel: auto зависит от тарифа и остатка кредитов', () => {
  const base = { registry: modelRegistry, balanceUsd: 5 };
  assert.equal(selectAgentModel({ ...base, plan: 'free' }).model.id, 'ketner-mini');
  assert.equal(selectAgentModel({ ...base, plan: 'pro' }).model.id, 'ketner-pro');
  // Кредитов нет: отвечает бесплатная модель агента, без отказа
  const dry = selectAgentModel({ ...base, balanceUsd: 0, plan: 'pro' });
  assert.equal(dry.model.id, 'north-mini-code');
  assert.ok(dry.reason);
  assert.ok(selectAgentModel({ ...base, plan: 'free', requestedId: 'claude-opus-5.5' }).denied);

  // Opus стоит ≈ 70 кредитов за шаг-запрос: на 20 кредитов хватает только Ketner Pro
  const premiumDry = selectAgentModel({
    ...base,
    plan: 'ultra',
    requestedId: 'claude-opus-5.5',
    balanceUsd: 0.02,
  });
  assert.equal(premiumDry.model.id, 'ketner-pro');
  assert.ok(premiumDry.reason);
  assert.equal(
    selectAgentModel({ ...base, plan: 'ultra', requestedId: 'claude-opus-5.5', balanceUsd: 0 })
      .model.id,
    'north-mini-code',
  );
  assert.equal(
    selectAgentModel({ ...base, plan: 'ultra', requestedId: 'claude-opus-5.5' }).model.id,
    'claude-opus-5.5',
  );
});

test('compactMessages сжимает старые результаты и большие аргументы, не трогая свежие', () => {
  const big = 'x'.repeat(20_000);
  const messages: ChatWireMessage[] = [
    { role: 'system', content: 's' },
    { role: 'user', content: 'task' },
  ];
  for (let i = 0; i < 12; i += 1) {
    messages.push({
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          id: `c${i}`,
          name: 'write_file',
          arguments: JSON.stringify({ path: `f${i}`, content: big }),
        },
      ],
    });
    messages.push({ role: 'tool', toolCallId: `c${i}`, content: big });
  }
  assert.equal(compactMessages(messages, 10_000_000), messages, 'под лимитом ничего не меняется');

  const compacted = compactMessages(messages, 50_000);
  assert.notEqual(compacted, messages);
  const tools = compacted.filter((m) => m.role === 'tool');
  assert.ok(tools[0].content.length < 1_000);
  assert.equal(tools[tools.length - 1].content.length, big.length);
  const firstCall = compacted.find((m) => m.role === 'assistant' && m.toolCalls);
  assert.ok(
    firstCall && firstCall.role === 'assistant' && firstCall.toolCalls![0].arguments.length < 1_000,
  );
  assert.doesNotThrow(() =>
    JSON.parse((firstCall as { toolCalls: Array<{ arguments: string }> }).toolCalls[0].arguments),
  );
  assert.equal(
    messages.filter((m) => m.role === 'tool')[0].content.length,
    big.length,
    'исходный массив не изменён',
  );
});

test('Free: агент работает на бесплатной North Mini Code, а при отказе пула берёт платный Ketner Mini', () =>
  withHarness(
    (call) => {
      if (call.index === 0) throw new OpenRouterError(call.model, 429, 'rate limit exceeded');
      return finalStep('done on the paid fallback');
    },
    async (h) => {
      const { result } = await h.run('anything');
      assert.equal(result.status, 'completed');
      assert.equal(h.calls[0].model, 'cohere/north-mini-code:free');
      assert.equal(h.calls[1].model, 'openai/gpt-6-luna');
      assert.equal(result.modelId, 'ketner-mini');
    },
    { plan: 'free' },
  ));

test('Free: если бесплатная модель отвечает, платная не вызывается', () =>
  withHarness(
    () => finalStep('free answer'),
    async (h) => {
      const { result } = await h.run('anything');
      assert.equal(result.status, 'completed');
      assert.deepEqual(
        h.calls.map((c) => c.model),
        ['cohere/north-mini-code:free'],
      );
      assert.equal(result.modelId, 'north-mini-code');
    },
    { plan: 'free' },
  ));

test('агент на модели Pro: medium, на Ultra в режиме Max — xhigh, запуск считается за 2', async () => {
  const efforts: unknown[] = [];
  await withHarness(
    (_call, options) => {
      efforts.push(options.reasoning);
      return finalStep('done');
    },
    async (h) => {
      await h.run('task', { modelId: 'claude-opus-5.5' });
      assert.deepEqual(efforts[0], { effort: 'medium' });
    },
    { plan: 'pro' },
  );
  await withHarness(
    (_call, options) => {
      efforts.push(options.reasoning);
      return finalStep('done');
    },
    async (h) => {
      await h.run('task', { modelId: 'claude-opus-5.5', reasoningMode: 'max' });
      assert.deepEqual(efforts[1], { effort: 'xhigh' });
    },
    { plan: 'ultra' },
  );
});

test('бюджет выбранной модели исчерпан: агент молча продолжает на Ketner Pro и доводит задачу', () =>
  withHarness(
    (call) =>
      call.index < 2
        ? toolStep([['write_file', { path: `f${call.index}.txt`, content: 'x' }]], 1.2)
        : call.index === 2
          ? toolStep([['write_file', { path: 'f2.txt', content: 'x' }]], 0.01)
          : finalStep('all done', 0.01),
    async (h) => {
      const { events, result } = await h.run('big task', { modelId: 'claude-opus-5.5' });
      assert.equal(result.status, 'completed');
      assert.deepEqual(
        h.calls.map((c) => c.model),
        [
          'anthropic/claude-opus-5.5',
          'anthropic/claude-opus-5.5',
          'xiaomi/mimo-v2.6-pro',
          'xiaomi/mimo-v2.6-pro',
        ],
      );
      assert.ok(events.some((e) => e.type === 'model_switch' && e.modelId === 'ketner-pro'));
      assert.ok(!events.some((e) => e.type === 'error'), 'ошибки пользователь не видит');
      assert.equal(result.modelId, 'ketner-pro');
      const note = h.calls[2].messages.at(-1);
      assert.ok(note?.role === 'user' && /continues on a lighter model/.test(note.content));
      for (const name of ['f0.txt', 'f1.txt', 'f2.txt']) {
        assert.ok(
          (await h.store.listFiles('u1', h.projectId)).some((f) => f.path === name),
          name,
        );
      }
    },
    { plan: 'pro' },
  ));

test('Opus → Ketner Pro → Haiku → бесплатная модель: цепочка до бесплатной, расход равен списанным кредитам', () =>
  withHarness(
    (call) =>
      toolStep(
        [['write_file', { path: `f${call.index}.txt`, content: 'x' }]],
        call.index < 2 ? 1.0 : 0.25,
      ),
    async (h) => {
      const before = h.credits.balance('u1', 'pro').remainingUsd;
      const { events, result } = await h.run('endless', { modelId: 'claude-opus-5.5' });
      assert.equal(
        result.status,
        'step_limit',
        'последняя ступень — бесплатная, её ограничивают шаги',
      );
      const switches = events
        .filter((e) => e.type === 'model_switch')
        .map((e) => (e.type === 'model_switch' ? e.modelId : ''));
      assert.deepEqual(switches, ['ketner-pro', 'claude-haiku-5.5', 'north-mini-code']);
      const spent = before - h.credits.balance('u1', 'pro').remainingUsd;
      assert.ok(
        Math.abs(spent - result.costUsd) < 1e-6,
        'с кредитов списано ровно столько, сколько стоил запуск',
      );
      assert.ok(
        result.costUsd <=
          getCodeLimits('pro').maxRunCostUsd +
            getCodeLimits('pro').continueWorkUsd +
            getCodeLimits('pro').continueLiteUsd +
            1.0,
        'платные ступени ограничены своими бюджетами (плюс последний шаг каждой)',
      );
    },
    { plan: 'pro' },
  ));

test('кредиты кончились до запуска: агент сразу работает на бесплатной модели и ничего не списывает', () =>
  withHarness(
    (call) => (call.index < 2 ? toolStep([['list_files', {}]], 0.5) : finalStep('готово', 0.5)),
    async (h) => {
      const { events, result } = await h.run('task');
      assert.equal(result.status, 'completed');
      assert.equal(result.modelId, 'north-mini-code');
      assert.equal(h.calls[0].model, 'cohere/north-mini-code:free');
      assert.equal(result.costUsd, 0);
      assert.equal(h.credits.balance('u1', 'plus').remainingUsd, 0);
      assert.ok(!events.some((e) => e.type === 'error'));
    },
    { plan: 'plus', credits: 0 },
  ));

test('работа по плану: пока в плане есть пункты, агент не заканчивает', () =>
  withHarness(
    (call) => {
      switch (call.index) {
        case 0:
          return toolStep([
            [
              'update_plan',
              {
                items: [
                  { text: 'Create a.txt', status: 'in_progress' },
                  { text: 'Create b.txt', status: 'pending' },
                ],
              },
            ],
            ['write_file', { path: 'a.txt', content: 'a' }],
          ]);
        case 1:
          return finalStep('Done with a.txt');
        case 2:
          return toolStep([
            ['write_file', { path: 'b.txt', content: 'b' }],
            [
              'update_plan',
              {
                items: [
                  { text: 'Create a.txt', status: 'done' },
                  { text: 'Create b.txt', status: 'done' },
                ],
              },
            ],
          ]);
        default:
          return finalStep('Both files created');
      }
    },
    async (h) => {
      const { events, result } = await h.run('create two files');
      assert.equal(result.status, 'completed');
      assert.equal(h.calls.length, 4);
      const nudge = h.calls[2].messages.at(-1);
      assert.ok(
        nudge?.role === 'user' &&
          /unfinished subtasks/.test(nudge.content) &&
          /Create b\.txt/.test(nudge.content),
      );
      const done = events.at(-1);
      assert.ok(done?.type === 'done' && done.plan?.every((item) => item.status === 'done'));
      const runItem = (await h.store.getThread('u1', h.projectId)).at(-1);
      assert.ok(runItem?.kind === 'run' && runItem.plan?.length === 2, 'план сохраняется в ленте');
    },
    { plan: 'pro' },
  ));

test('update_plan: в работе не больше одного пункта, модель получает текущий пункт', () =>
  withHarness(
    (call) =>
      call.index === 0
        ? toolStep([
            [
              'update_plan',
              {
                items: [
                  { text: 'A', status: 'in_progress' },
                  { text: 'B', status: 'in_progress' },
                ],
              },
            ],
          ])
        : finalStep('ok'),
    async (h) => {
      const { events } = await h.run('plan');
      const plan = events.find((e) => e.type === 'plan');
      assert.ok(plan?.type === 'plan');
      assert.deepEqual(
        plan.items.map((i) => i.status),
        ['in_progress', 'pending'],
      );
      const toolMessage = h.calls[1].messages.find((m) => m.role === 'tool');
      assert.match(toolMessage?.content ?? '', /Now working on: "A"/);
    },
    { plan: 'free' },
  ));
