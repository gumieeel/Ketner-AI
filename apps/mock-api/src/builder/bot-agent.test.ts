/**
 * Бот на пути платформы (этап D): ядро цикла + настоящий AIGateway (выбор модели, учёт, списание)
 * + журнал исполнений. Провайдер поддельный, без сети.
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type {
  AgentProviderRequest,
  AgentProviderResult,
  AgentStreamEvent,
} from '../ai/agent/agent-types.js';
import { TOOL_ERROR_MESSAGES } from '../agent-core/types.js';
import { CircuitBreaker } from '../ai/circuit-breaker.js';
import { AIGateway } from '../ai/gateway.js';
import type { AIProvider, ProviderResponse } from '../ai/gateway-types.js';
import { ModelRegistry } from '../ai/model-registry.js';
import { ProviderManager } from '../ai/providers/provider-factory.js';
import { runMigrations } from '../db/migrate.js';
import { MIGRATIONS } from '../db/migration-list.js';
import {
  MemoryExecutionJournal,
  PostgresExecutionJournal,
  type ExecutionJournal,
} from '../platform/journal.js';
import { memoryCredits, setBalance } from '../services/credits-fixture.js';
import { UsageStore } from '../store/usage-store.js';
import { openTestSql } from '../testing/sql.js';
import { BotAgentRuntime, searchKnowledge, type BotAgentInput } from './bot-agent.js';
import { BOT_REPLY_CAP_USD, BOT_REPLY_TOKENS } from './bot-service.js';
import { defaultConfig } from './service.js';

const OWNER = 'owner-d';
const aiConfig = {
  thinkingMs: [0, 0],
  chunkMs: [0, 0],
  failureRate: 0,
  random: () => 0.5,
} as const;

type Turn = (
  request: AgentProviderRequest,
  emit: (event: AgentStreamEvent) => void,
) => Partial<AgentProviderResult>;

function setup(
  turns: Turn[] | ((n: number) => Turn),
  journal: ExecutionJournal = new MemoryExecutionJournal(),
  limits: ConstructorParameters<typeof BotAgentRuntime>[0]['limits'] = {},
) {
  const journalErrors: string[] = [];
  const calls: AgentProviderRequest[] = [];
  const provider = {
    type: 'openrouter' as const,
    name: 'Fake',
    isAvailable: () => true,
    async generateText(): Promise<ProviderResponse> {
      throw new Error('not used');
    },
    async streamText(): Promise<ProviderResponse> {
      throw new Error('the platform path must not use streamText');
    },
    async streamAgent(
      request: AgentProviderRequest,
      hooks: { onEvent: (e: AgentStreamEvent) => void },
    ) {
      calls.push(request);
      const turn =
        typeof turns === 'function'
          ? turns(calls.length)
          : turns[Math.min(calls.length, turns.length) - 1]!;
      const partial = turn(request, hooks.onEvent);
      return {
        content: partial.content ?? '',
        toolCalls: partial.toolCalls ?? [],
        finishReason:
          partial.finishReason ?? ((partial.toolCalls?.length ?? 0) > 0 ? 'tool_calls' : 'stop'),
        usage: partial.usage ?? { inputTokens: 100, outputTokens: 20 },
        cost: partial.cost ?? 0.0002,
        model: request.model,
      } satisfies AgentProviderResult;
    },
  } as unknown as AIProvider;
  const providers = new ProviderManager();
  providers.setProvider('openrouter', provider);
  const usage = new UsageStore(join(mkdtempSync(join(tmpdir(), 'ketner-d-')), 'usage.json'));
  const credits = memoryCredits();
  setBalance(credits, OWNER, 'credits', 1_000);
  const gateway = new AIGateway({
    registry: new ModelRegistry(),
    providers,
    usageStore: usage,
    aiConfig,
    circuitBreaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 }),
    useMockEngine: false,
    credits,
  });
  const runtime = new BotAgentRuntime({
    gateway,
    journal,
    limits,
    log: (message, details) => journalErrors.push(`${message} ${JSON.stringify(details)}`),
  });
  return { calls, usage, credits, runtime, journal, journalErrors };
}

const config = {
  ...defaultConfig('Керамика', 'ru'),
  knowledge: 'Доставка по Алматы — 1 500 ₸. Мастер-класс — 12 000 ₸.',
};
const bot = {
  slug: 'keramika',
  greeting: '',
  quickReplies: [],
  dailyCapCredits: 1000,
  corrections: [{ question: 'Работаете в воскресенье?', answer: 'Да, с 11 до 17.' }],
};

function input(overrides: Partial<BotAgentInput> = {}): BotAgentInput {
  return {
    caller: { userId: OWNER, plan: 'credits', isVip: false, anonymous: false, language: 'ru' },
    solutionId: 'sol-d',
    version: 1,
    config,
    bot,
    gatewayConversationId: 'bot:conv-d',
    triggerKind: 'public_page',
    triggerRef: 'conversation:conv-d',
    messages: [{ role: 'user', content: 'Сколько стоит доставка?' }],
    maxOutputTokens: BOT_REPLY_TOKENS,
    replyCapUsd: BOT_REPLY_CAP_USD,
    ...overrides,
  };
}

const toolCall = (name: string, args: string, id = 'call_1') => ({
  id,
  type: 'function' as const,
  function: { name, arguments: args },
});
const answer =
  (text: string, cost = 0.0003): Turn =>
  (_request, emit) => {
    emit({ kind: 'content', text });
    return { content: text, cost };
  };
const balance = (env: ReturnType<typeof setup>) =>
  env.credits.balance(OWNER, 'credits').remainingUsd;

test('этап D: бот ищет в знаниях и отвечает; учёт как у прежнего пути, журнал по шагам', async () => {
  const env = setup([
    () => ({ toolCalls: [toolCall('knowledge_search', '{"query":"доставка Алматы"}')] }),
    answer('Доставка по Алматы — 1 500 ₸.'),
  ]);
  const before = balance(env);
  const result = await env.runtime.answer(input());
  assert.deepEqual(
    { text: result.text, error: result.error, offerContact: result.offerContact },
    { text: 'Доставка по Алматы — 1 500 ₸.', error: null, offerContact: false },
  );
  // Провайдер: промпт бота (как у прежнего пути) + инструменты; результат поиска — во втором шаге.
  const system = env.calls[0]!.messages[0]!;
  assert.ok(
    system.role === 'system' &&
      system.content.includes('Доставка по Алматы — 1 500 ₸') &&
      system.content.includes('knowledge_search'),
  );
  assert.deepEqual(
    env.calls[0]!.tools?.map((t) => t.function.name),
    ['knowledge_search', 'offer_contact'],
  );
  const found = env.calls[1]!.messages.at(-1);
  assert.ok(found?.role === 'tool' && found.content.includes('1 500 ₸'));
  // Учёт: запись на шаг, поля — как у ответа бота сейчас; списано ровно за два шага.
  const records = env.usage.getByUser(OWNER).slice().reverse();
  assert.deepEqual(
    records.map((r) => [r.kind, r.runId, r.conversationId, r.estimatedCost, r.creditsUsd]),
    [
      ['assistant', 'sol-d', 'bot:conv-d', 0.0002, 0.0002],
      ['assistant', 'sol-d', 'bot:conv-d', 0.0003, 0.0003],
    ],
  );
  assert.equal(result.creditsUsd, 0.0005);
  assert.equal(Number((before - balance(env)).toFixed(6)), 0.0005);
  // Журнал Slice A: пишется пакетом после ответа.
  await env.runtime.drain();
  const journal = env.journal as MemoryExecutionJournal;
  const [execution] = [...journal.executions.values()];
  assert.equal(execution?.status, 'succeeded');
  assert.equal(execution?.stopReason, 'answer');
  assert.equal(execution?.creditsUsd, 0.0005);
  assert.deepEqual(
    [...journal.effects.values()].map((e) => [e.stepKey, e.action, e.authorizedBy, e.status]),
    [
      ['model-1', 'reply.draft', 'risk_low', 'committed'],
      ['tool-1-call_1', 'knowledge.search', 'risk_low', 'committed'],
      ['model-2', 'reply.draft', 'risk_low', 'committed'],
      ['reply', 'reply.send_in_session', 'legacy_bot_enablement:sol-d', 'committed'],
    ],
  );
  assert.equal(journal.deployments.length, 1);
  assert.ok(journal.specs.has('sol-d:1'));
  assert.deepEqual(
    journal.events.map((e) => [e.seq, e.type]),
    [
      [1, 'cost'],
      [2, 'authorization'],
      [3, 'cost'],
      [4, 'status'],
    ],
  );
  assert.deepEqual(env.journalErrors, []);
});

// ── Обязательные сценарии через настоящий шлюз ───────────────────────────────────────────────

test('этап D, обязательный: неизвестный вопрос → эскалация, форма контакта, одна оплата шага', async () => {
  const env = setup([
    (_r, emit) => {
      emit({ kind: 'content', text: 'Это уточнит сотрудник.' });
      return {
        content: 'Это уточнит сотрудник.',
        toolCalls: [toolCall('offer_contact', '{"reason":"unknown_answer"}')],
      };
    },
    answer('не должно вызываться'),
  ]);
  const result = await env.runtime.answer(
    input({ messages: [{ role: 'user', content: 'Возите в Астану?' }] }),
  );
  assert.equal(result.offerContact, true);
  assert.equal(result.text, 'Это уточнит сотрудник.');
  assert.equal(result.error, null);
  assert.equal(env.calls.length, 1, 'после эскалации модель не вызывается');
  await env.runtime.drain();
  const [execution] = [...(env.journal as MemoryExecutionJournal).executions.values()];
  assert.deepEqual([execution?.status, execution?.stopReason], ['succeeded', 'escalated']);
});

test('этап D, обязательный: сбой инструмента — модель получает ошибку и отвечает', async () => {
  const env = setup([
    () => ({ toolCalls: [toolCall('knowledge_search', '{}')] }),
    answer('Уточню у сотрудника.'),
  ]);
  const result = await env.runtime.answer(input());
  assert.equal(result.text, 'Уточню у сотрудника.');
  const failed = env.calls[1]!.messages.at(-1);
  assert.ok(failed?.role === 'tool' && failed.content === TOOL_ERROR_MESSAGES.invalid_arguments);
});

/** На шаге без инструментов (`toolChoice: 'none'`, последний ответ после лимита) модель отвечает текстом. */
const FINAL_TEXT = 'Доставка по Алматы — 1 500 ₸. Остальное уточнит сотрудник.';
const orFinal =
  (turn: Turn, cost?: number): Turn =>
  (request, emit) =>
    request.toolChoice === 'none'
      ? answer(FINAL_TEXT, cost ?? 0.0003)(request, emit)
      : turn(request, emit);

test('этап D, обязательный: сбои инструмента подряд — последний ответ без инструментов, форма контакта', async () => {
  const env = setup(() =>
    orFinal(() => ({ toolCalls: [toolCall('knowledge_search', 'not json')] })),
  );
  const result = await env.runtime.answer(input());
  // 3a: после двух сбоев подряд — шаг без инструментов; посетитель получает ответ и форму контакта.
  assert.deepEqual(
    { text: result.text, error: result.error, offerContact: result.offerContact },
    { text: FINAL_TEXT, error: null, offerContact: true },
  );
  assert.equal(env.calls.length, 3);
  assert.equal(env.calls[2]!.toolChoice, 'none');
  assert.ok(env.calls[2]!.tools && env.calls[2]!.tools.length > 0, 'описания инструментов те же');
  // 3d: модель видит безопасное сообщение; подробность разбора — только в журнале.
  const toolMessages = env.calls[2]!.messages.filter((m) => m.role === 'tool');
  assert.deepEqual(
    toolMessages.map((m) => m.role === 'tool' && m.content),
    [TOOL_ERROR_MESSAGES.invalid_json, TOOL_ERROR_MESSAGES.invalid_json],
  );
  await env.runtime.drain();
  const journal = env.journal as MemoryExecutionJournal;
  const [execution] = [...journal.executions.values()];
  assert.deepEqual(
    [execution?.status, execution?.stopReason, execution?.outputMeta.finalStep],
    ['succeeded', 'failures', true],
  );
  const errors = journal.events.filter((e) => e.type === 'error');
  assert.equal(errors.length, 2);
  assert.equal(errors[0]!.data.code, 'invalid_json');
  assert.match(String(errors[0]!.data.detail), /JSON/);
  assert.ok(!JSON.stringify(env.calls[2]!.messages).includes(String(errors[0]!.data.detail)));
});

test('этап D, обязательный: лимит шагов — последний шаг без инструментов, списание не больше потолка', async () => {
  const looping = (n: number): Turn =>
    orFinal(() => ({
      toolCalls: [toolCall('knowledge_search', `{"query":"цены ${n}"}`, `call_${n}`)],
      cost: 0.0004,
    }));
  // Лимит шагов AgentSpec бота (6); лимит вызовов инструментов поднят, чтобы сработал именно лимит шагов.
  const env = setup(looping, new MemoryExecutionJournal(), { maxToolCalls: 20 });
  const result = await env.runtime.answer(input());
  assert.equal(result.error, null);
  assert.equal(result.text, FINAL_TEXT);
  assert.equal(result.offerContact, true);
  assert.equal(env.calls.length, 6, 'AgentSpec бота: maxSteps = 6, последний шаг входит в лимит');
  assert.deepEqual(
    env.calls.map((c) => c.toolChoice ?? 'auto'),
    ['auto', 'auto', 'auto', 'auto', 'auto', 'none'],
  );
  assert.equal(env.usage.getByUser(OWNER).length, 6);
  assert.ok(result.creditsUsd <= BOT_REPLY_CAP_USD);
  await env.runtime.drain();
  const [execution] = [...(env.journal as MemoryExecutionJournal).executions.values()];
  assert.deepEqual([execution?.status, execution?.stopReason], ['succeeded', 'max_steps']);
  // С лимитами AgentSpec как есть раньше срабатывает лимит вызовов инструментов (4): 5 шагов + последний.
  const defaults = setup(looping);
  const stopped = await defaults.runtime.answer(input());
  assert.equal(stopped.text, FINAL_TEXT);
  assert.equal(defaults.calls.length, 6);
  await defaults.runtime.drain();
  const [capped] = [...(defaults.journal as MemoryExecutionJournal).executions.values()];
  assert.equal(capped?.stopReason, 'max_tool_calls');
});

test('этап D, обязательный: потолок кредитов на ответ по сумме шагов — 0,03 $, последний ответ на резерве', async () => {
  // Шаг дороже трети потолка (0,02 $): после первого шага остаток 0,01 $ меньше резерва — сразу
  // последний шаг без инструментов на весь остаток. Без резерва (прежнее поведение) владелец платил
  // те же 0,03 $, а посетитель получал ошибку.
  const env = setup((n) =>
    orFinal(
      () => ({
        toolCalls: [toolCall('knowledge_search', '{"query":"цены"}', `call_${n}`)],
        cost: 0.02,
      }),
      0.02,
    ),
  );
  const before = balance(env);
  const result = await env.runtime.answer(input());
  assert.equal(result.error, null);
  assert.equal(result.text, FINAL_TEXT);
  assert.equal(result.offerContact, true);
  assert.equal(env.calls.length, 2);
  assert.equal(env.calls[1]!.toolChoice, 'none');
  const records = env.usage.getByUser(OWNER).slice().reverse();
  assert.deepEqual(
    records.map((r) => [r.estimatedCost, r.creditsUsd]),
    [
      [0.02, 0.02],
      [0.02, 0.01],
    ],
  );
  assert.equal(result.creditsUsd, BOT_REPLY_CAP_USD);
  assert.equal(Number((before - balance(env)).toFixed(6)), BOT_REPLY_CAP_USD);
  await env.runtime.drain();
  const [execution] = [...(env.journal as MemoryExecutionJournal).executions.values()];
  assert.deepEqual([execution?.status, execution?.stopReason], ['succeeded', 'budget']);
});

test('этап D: повтор исполнения с тем же ключом — без вызова модели и без списания', async () => {
  const env = setup([answer('Здравствуйте!')]);
  const first = await env.runtime.answer(input({ idempotencyKey: 'bot_message:m1' }));
  const second = await env.runtime.answer(input({ idempotencyKey: 'bot_message:m1' }));
  assert.equal(first.text, 'Здравствуйте!');
  assert.equal(second.error?.code, 'duplicate_execution');
  assert.equal(env.calls.length, 1);
});

test('этап D: поиск в знаниях находит фразы и исправленные ответы', () => {
  assert.deepEqual(searchKnowledge(config, bot, 'Сколько стоит доставка?'), [
    'Доставка по Алматы — 1 500 ₸.',
  ]);
  assert.deepEqual(searchKnowledge(config, bot, 'воскресенье'), [
    'Работаете в воскресенье? — Да, с 11 до 17.',
  ]);
  assert.deepEqual(searchKnowledge(config, bot, '??'), []);
});

test('этап D: журнал на PostgreSQL — исполнение, события, эффекты, спецификация, включение', async (t) => {
  const sql = await openTestSql();
  if (!sql) {
    t.skip('нет PGlite и TEST_DATABASE_URL');
    return;
  }
  try {
    await runMigrations(sql.db, MIGRATIONS);
    await sql.runner.query(
      `INSERT INTO solutions (id, user_id, type, status, name, current_version, active_version, template)
       VALUES ('sol-d', $1, 'customer_bot', 'active', 'Керамика', 2, 1, 'customer_bot')`,
      [OWNER],
    );
    await sql.runner.query(
      `INSERT INTO solution_versions (solution_id, number, config) VALUES ('sol-d', 1, '{}'), ('sol-d', 2, '{}')`,
    );
    const env = setup(
      [
        () => ({ toolCalls: [toolCall('knowledge_search', '{"query":"доставка"}')] }),
        answer('1 500 ₸.'),
      ],
      new PostgresExecutionJournal(sql.runner),
    );
    const result = await env.runtime.answer(input({ idempotencyKey: 'bot_message:pg1' }));
    assert.equal(result.text, '1 500 ₸.');
    await env.runtime.drain();
    assert.deepEqual(env.journalErrors, []);
    const [execution] = await sql.runner.query<{
      status: string;
      stop_reason: string;
      credits_usd: string;
      runtime: string;
    }>(`SELECT status, stop_reason, credits_usd, runtime FROM executions WHERE user_id = $1`, [
      OWNER,
    ]);
    assert.deepEqual(
      { ...execution, credits_usd: Number(execution?.credits_usd) },
      { status: 'succeeded', stop_reason: 'answer', credits_usd: 0.0005, runtime: 'agent_gateway' },
    );
    const effects = await sql.runner.query<{
      step_key: string;
      status: string;
      authorized_by: string;
    }>(
      `SELECT step_key, status, authorized_by FROM execution_effects ORDER BY reserved_at, step_key`,
    );
    assert.deepEqual(effects.map((e) => [e.step_key, e.status, e.authorized_by]).sort(), [
      ['model-1', 'committed', 'risk_low'],
      ['model-2', 'committed', 'risk_low'],
      ['reply', 'committed', 'legacy_bot_enablement:sol-d'],
      ['tool-1-call_1', 'committed', 'risk_low'],
    ]);
    // События: расход двух шагов, право на поиск, причина остановки; ни одна запись журнала не сорвалась.
    const events = await sql.runner.query<{ seq: number; type: string; action: string | null }>(
      `SELECT seq, type, action FROM execution_events ORDER BY seq`,
    );
    assert.deepEqual(
      events.map((e) => [e.seq, e.type, e.action]),
      [
        [1, 'cost', null],
        [2, 'authorization', 'knowledge.search'],
        [3, 'cost', null],
        [4, 'status', null],
      ],
    );
    assert.deepEqual(env.journalErrors, []);
    // Повтор с тем же ключом не создаёт исполнения и не вызывает модель.
    const again = await env.runtime.answer(input({ idempotencyKey: 'bot_message:pg1' }));
    assert.equal(again.error?.code, 'duplicate_execution');
    assert.equal(env.calls.length, 2);
    // Новая версия бота: прежнее включение закрывается, открывается новое.
    await env.runtime.answer(input({ version: 2, idempotencyKey: 'bot_message:pg2' }));
    await env.runtime.drain();
    const deployments = await sql.runner.query<{ agent_version: number; state: string }>(
      `SELECT agent_version, state FROM agent_deployments ORDER BY activated_at, agent_version`,
    );
    assert.deepEqual(
      deployments.map((d) => [d.agent_version, d.state]),
      [
        [1, 'ended'],
        [2, 'active'],
      ],
    );
    // JSON хранится объектами, а не строками (проверка снимка спецификации работает по полю).
    const [kinds] = await sql.runner.query<Record<string, string>>(
      `SELECT (SELECT jsonb_typeof(spec) FROM solution_version_specs LIMIT 1) AS spec,
              (SELECT spec ->> 'specVersion' FROM solution_version_specs LIMIT 1) AS spec_version,
              (SELECT jsonb_typeof(input_meta) FROM executions LIMIT 1) AS input_meta,
              (SELECT jsonb_typeof(output_meta) FROM executions WHERE status = 'succeeded' LIMIT 1) AS output_meta,
              (SELECT string_agg(DISTINCT jsonb_typeof(data), ',') FROM execution_events) AS event_data,
              (SELECT string_agg(DISTINCT jsonb_typeof(result_meta), ',') FROM execution_effects) AS result_meta`,
    );
    assert.deepEqual(kinds, {
      spec: 'object',
      spec_version: '1',
      input_meta: 'object',
      output_meta: 'object',
      event_data: 'object',
      result_meta: 'object',
    });
    const [{ specs }] = await sql.runner.query<{ specs: string }>(
      `SELECT count(*) AS specs FROM solution_version_specs`,
    );
    assert.equal(Number(specs), 2);
  } finally {
    await sql.close();
  }
});
