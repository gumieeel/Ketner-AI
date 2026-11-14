import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentToolCall } from '../ai/agent/agent-types.js';
import { runAgentLoop } from './loop.js';
import {
  StepError,
  TOOL_ERROR_MESSAGES,
  type LoopEvent,
  type LoopLimits,
  type LoopTool,
  type StepInput,
  type StepResult,
} from './types.js';

const LIMITS: LoopLimits = {
  maxSteps: 6,
  maxToolCalls: 4,
  maxToolCallsPerStep: 4,
  maxConsecutiveFailures: 2,
  timeoutMs: 5_000,
  budgetUsd: 0.03,
  minStepBudgetUsd: 0.0005,
};

const call = (name: string, args: unknown = {}, id = `c_${name}`): AgentToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
});

/** Шаг модели по сценарию; списание — как у шлюза: min(цена, потолок шага). */
function scripted(
  plan: Array<{ text?: string; toolCalls?: AgentToolCall[]; costUsd?: number }>,
  inputs: StepInput[] = [],
) {
  return async (input: StepInput): Promise<StepResult> => {
    inputs.push(input);
    const next = plan[Math.min(input.step - 1, plan.length - 1)]!;
    const costUsd = next.costUsd ?? 0.001;
    return {
      text: next.text ?? '',
      toolCalls: next.toolCalls ?? [],
      usage: { inputTokens: 10, outputTokens: 5 },
      costUsd,
      creditsUsd: Math.min(costUsd, Math.max(0, input.maxChargeUsd)),
      model: { id: 'm', name: 'M' },
    };
  };
}

const allowAll = () => ({ allowed: true as const, authorizedBy: 'risk_low' });

function tool(name: string, action: string, execute: LoopTool['execute']): LoopTool {
  return {
    name,
    action,
    description: name,
    parameters: { type: 'object' },
    parse: (input) => ({ ok: true, value: input }),
    execute,
  };
}

const search = tool('knowledge_search', 'knowledge.search', async () => ({
  content: 'Доставка — 1 500 ₸.',
}));
const offerContact = tool('offer_contact', 'lead.create', async (input) => ({
  content: 'form shown',
  escalate: { reason: String((input as { reason?: string }).reason ?? 'unknown_answer') },
}));

test('цикл: ответ без инструментов — один шаг, причина answer', async () => {
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'Привет' }],
    tools: [search],
    step: scripted([{ text: 'Здравствуйте!' }]),
    authorize: allowAll,
    limits: LIMITS,
  });
  assert.equal(result.stopReason, 'answer');
  assert.equal(result.text, 'Здравствуйте!');
  assert.equal(result.steps, 1);
});

test('цикл: вызов инструмента, результат уходит модели, затем ответ', async () => {
  const inputs: StepInput[] = [];
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'Сколько доставка?' }],
    tools: [search],
    step: scripted(
      [{ toolCalls: [call('knowledge_search', { query: 'доставка' })] }, { text: '1 500 ₸.' }],
      inputs,
    ),
    authorize: allowAll,
    limits: LIMITS,
  });
  assert.equal(result.stopReason, 'answer');
  assert.equal(result.text, '1 500 ₸.');
  assert.deepEqual(result.toolCalls, [{ tool: 'knowledge_search', ok: true }]);
  const second = inputs[1]!.messages;
  assert.equal(second.at(-2)?.role, 'assistant');
  assert.deepEqual(second.at(-1), {
    role: 'tool',
    tool_call_id: 'c_knowledge_search',
    content: 'Доставка — 1 500 ₸.',
  });
});

// ── Обязательные сценарии (docs/AGENT_LOOP_CONVERGENCE.md, раздел 4) ─────────────────────────────

test('обязательный сценарий: неизвестный вопрос → эскалация, второго шага модели нет', async () => {
  const inputs: StepInput[] = [];
  const events: LoopEvent[] = [];
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'Есть ли у вас доставка в Астану?' }],
    tools: [search, offerContact],
    step: scripted(
      [
        { toolCalls: [call('knowledge_search', { query: 'Астана' })] },
        {
          text: 'Уточнит сотрудник.',
          toolCalls: [call('offer_contact', { reason: 'unknown_answer' })],
        },
        { text: 'не должно вызываться' },
      ],
      inputs,
    ),
    authorize: allowAll,
    limits: LIMITS,
    onEvent: (event) => {
      events.push(event);
    },
  });
  assert.equal(result.stopReason, 'escalated');
  assert.deepEqual(result.escalation, { tool: 'offer_contact', reason: 'unknown_answer' });
  assert.equal(result.text, 'Уточнит сотрудник.');
  assert.equal(inputs.length, 2, 'после эскалации модель больше не вызывается');
  assert.deepEqual(events.at(-1), { type: 'stopped', reason: 'escalated' });
});

test('обязательный сценарий: сбой инструмента — ошибка уходит модели, цикл продолжается', async () => {
  const inputs: StepInput[] = [];
  const broken = tool('knowledge_search', 'knowledge.search', async () => {
    throw new Error('index unavailable');
  });
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'Цены?' }],
    tools: [broken],
    step: scripted(
      [
        { toolCalls: [call('knowledge_search', { query: 'цены' })] },
        { text: 'Уточню у сотрудника.' },
      ],
      inputs,
    ),
    authorize: allowAll,
    limits: LIMITS,
  });
  assert.equal(result.stopReason, 'answer');
  assert.deepEqual(result.toolCalls, [{ tool: 'knowledge_search', ok: false }]);
  // Модель получает безопасное сообщение, а не текст исключения (тест 3d ниже).
  const toolResult = inputs[1]!.messages.at(-1);
  assert.deepEqual(toolResult, {
    role: 'tool',
    tool_call_id: 'c_knowledge_search',
    content: TOOL_ERROR_MESSAGES.tool_failed,
  });
});

test('обязательный сценарий: сбои инструмента подряд — остановка failures', async () => {
  const broken = tool('knowledge_search', 'knowledge.search', async () => {
    throw new Error('down');
  });
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'Цены?' }],
    tools: [broken],
    step: scripted([{ toolCalls: [call('knowledge_search', { query: 'x' })] }]),
    authorize: allowAll,
    limits: LIMITS,
  });
  assert.equal(result.stopReason, 'failures');
  assert.equal(result.steps, 2, `после ${LIMITS.maxConsecutiveFailures} сбоев подряд`);
});

test('обязательный сценарий: лимит шагов — остановка max_steps, шагов ровно maxSteps', async () => {
  let n = 0;
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'Цены?' }],
    tools: [search],
    step: async (input) => {
      n += 1;
      return {
        text: '',
        toolCalls: [call('knowledge_search', { query: `q${n}` }, `c${n}`)],
        usage: { inputTokens: 1, outputTokens: 1 },
        costUsd: 0.0001,
        creditsUsd: Math.min(0.0001, input.maxChargeUsd),
        model: null,
      };
    },
    authorize: allowAll,
    limits: { ...LIMITS, maxToolCalls: 100 },
  });
  assert.equal(result.stopReason, 'max_steps');
  assert.equal(result.steps, LIMITS.maxSteps);
  assert.equal(n, LIMITS.maxSteps);
});

test('обязательный сценарий: потолок кредитов на ответ — сумма шагов не больше потолка, затем budget', async () => {
  const inputs: StepInput[] = [];
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'Цены?' }],
    tools: [search],
    step: scripted(
      [{ toolCalls: [call('knowledge_search', { query: 'x' })], costUsd: 0.012 }],
      inputs,
    ),
    authorize: allowAll,
    limits: { ...LIMITS, maxToolCalls: 100 },
  });
  assert.equal(result.stopReason, 'budget');
  // Шаги получили остаток потолка: 0.03 → 0.018 → 0.006; списано 0.012 + 0.012 + 0.006.
  assert.deepEqual(
    inputs.map((i) => i.maxChargeUsd),
    [0.03, 0.018, 0.006],
  );
  assert.equal(result.creditsUsd, 0.03);
  assert.equal(result.costUsd, 0.036, 'полная себестоимость пишется полностью');
  assert.ok(result.creditsUsd <= LIMITS.budgetUsd);
});

// ── Права, лимиты, сбои шага ─────────────────────────────────────────────────────────────────

test('цикл: действие вне прав не выполняется, модель получает отказ', async () => {
  let executed = false;
  const risky = tool('send_message', 'message.send', async () => {
    executed = true;
    return { content: 'sent' };
  });
  const inputs: StepInput[] = [];
  const events: LoopEvent[] = [];
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'Напиши клиенту' }],
    tools: [risky],
    step: scripted([{ toolCalls: [call('send_message', {})] }, { text: 'Не могу.' }], inputs),
    authorize: (action) =>
      action === 'message.send' ? { allowed: false, reason: 'not_in_agent_spec' } : allowAll(),
    limits: LIMITS,
    onEvent: (e) => {
      events.push(e);
    },
  });
  assert.equal(executed, false);
  assert.equal(result.stopReason, 'answer');
  assert.ok(events.some((e) => e.type === 'tool_denied' && e.action === 'message.send'));
  const denied = inputs[1]!.messages.at(-1);
  assert.ok(denied?.role === 'tool' && denied.content.includes('not allowed'));
});

test('цикл: неизвестный инструмент и неверные аргументы — ошибка для модели, не исключение', async () => {
  const inputs: StepInput[] = [];
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'x' }],
    tools: [search],
    step: scripted(
      [
        { toolCalls: [call('nope', {}), call('knowledge_search', '{bad json', 'c2')] },
        { text: 'ok' },
      ],
      inputs,
    ),
    authorize: allowAll,
    limits: { ...LIMITS, maxConsecutiveFailures: 5 },
  });
  assert.equal(result.stopReason, 'answer');
  const tools = inputs[1]!.messages.filter((m) => m.role === 'tool');
  assert.ok(tools[0]?.role === 'tool' && tools[0].content.includes('unknown tool'));
  assert.ok(tools[1]?.role === 'tool' && tools[1].content.includes('not valid JSON'));
});

test('цикл: лишние вызовы в одном шаге не выполняются; всего вызовов — max_tool_calls', async () => {
  let executions = 0;
  const counting = tool('knowledge_search', 'knowledge.search', async () => {
    executions += 1;
    return { content: 'ok' };
  });
  const calls = [1, 2, 3].map((i) => call('knowledge_search', { query: `q${i}` }, `c${i}`));
  const perStep = await runAgentLoop({
    messages: [{ role: 'user', content: 'x' }],
    tools: [counting],
    step: scripted([{ toolCalls: calls }, { text: 'готово' }]),
    authorize: allowAll,
    limits: { ...LIMITS, maxToolCallsPerStep: 2 },
  });
  assert.equal(perStep.stopReason, 'answer');
  assert.equal(executions, 2);
  executions = 0;
  const total = await runAgentLoop({
    messages: [{ role: 'user', content: 'x' }],
    tools: [counting],
    step: scripted([{ toolCalls: calls }]),
    authorize: allowAll,
    limits: { ...LIMITS, maxToolCalls: 2 },
  });
  assert.equal(total.stopReason, 'max_tool_calls');
  assert.equal(executions, 2);
});

test('цикл: ошибка шага — причина error с кодом шлюза; срок прогона — timeout', async () => {
  const failed = await runAgentLoop({
    messages: [{ role: 'user', content: 'x' }],
    tools: [],
    step: async () => {
      throw new StepError('provider_error', 'all models failed');
    },
    authorize: allowAll,
    limits: LIMITS,
  });
  assert.equal(failed.stopReason, 'error');
  assert.deepEqual(failed.error, { code: 'provider_error', message: 'all models failed' });

  const slow = await runAgentLoop({
    messages: [{ role: 'user', content: 'x' }],
    tools: [],
    step: (input) =>
      new Promise((_, reject) => {
        input.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
    authorize: allowAll,
    limits: { ...LIMITS, timeoutMs: 30 },
  });
  assert.equal(slow.stopReason, 'timeout');
});

test('цикл: ошибка обработчика событий не ломает прогон', async () => {
  const hookErrors: unknown[] = [];
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'x' }],
    tools: [],
    step: scripted([{ text: 'ok' }]),
    authorize: allowAll,
    limits: LIMITS,
    onEvent: () => {
      throw new Error('journal down');
    },
    onHookError: (error) => hookErrors.push(error),
  });
  assert.equal(result.stopReason, 'answer');
  assert.ok(hookErrors.length >= 2);
});

// ── Безопасные ошибки инструментов (3d) ──────────────────────────────────────────────────────

const SAFE = new Set<string>(Object.values(TOOL_ERROR_MESSAGES));

test('3d: модель получает только безопасные сообщения; полная ошибка — в событиях для журнала', async () => {
  const internal =
    'connect ECONNREFUSED 10.0.4.17:5432 at /srv/ketner/app/dist/db.js:88 (user=ketner_backend password=hunter2)';
  const broken = tool('knowledge_search', 'knowledge.search', async () => {
    throw new Error(internal);
  });
  const strict: LoopTool = {
    ...tool('offer_contact', 'lead.create', async () => ({ content: 'ok' })),
    parse: () => ({ ok: false, error: 'reason must be one of: internal_enum_a, internal_enum_b' }),
  };
  const inputs: StepInput[] = [];
  const events: LoopEvent[] = [];
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'Цены?' }],
    tools: [broken, strict],
    step: scripted(
      [
        {
          toolCalls: [
            call('knowledge_search', { query: 'цены' }, 'k1'),
            call('offer_contact', { reason: 'x' }, 'o1'),
            call('drop_database', {}, 'd1'),
            call('knowledge_search', '{"query":', 'k2'),
          ],
        },
        { text: 'Уточню у сотрудника.' },
      ],
      inputs,
    ),
    authorize: allowAll,
    limits: { ...LIMITS, maxConsecutiveFailures: 10 },
    onEvent: (e) => {
      events.push(e);
    },
  });
  assert.equal(result.stopReason, 'answer');
  const toolMessages = inputs[1]!.messages.filter((m) => m.role === 'tool');
  assert.deepEqual(
    toolMessages.map((m) => m.role === 'tool' && m.content),
    [
      TOOL_ERROR_MESSAGES.tool_failed,
      TOOL_ERROR_MESSAGES.invalid_arguments,
      TOOL_ERROR_MESSAGES.unknown_tool,
      TOOL_ERROR_MESSAGES.invalid_json,
    ],
  );
  const seenByModel = JSON.stringify(inputs[1]!.messages);
  for (const leak of [
    'ECONNREFUSED',
    '10.0.4.17',
    '/srv/ketner',
    'hunter2',
    'internal_enum_a',
    'drop_database is',
  ]) {
    assert.ok(!seenByModel.includes(leak), `модель не видит «${leak}»`);
  }
  // Журнал получает подробности: код и текст ошибки, причину отказа.
  const failed = events.find((e) => e.type === 'tool_finished' && !e.ok);
  assert.ok(failed?.type === 'tool_finished');
  assert.equal(failed.error?.code, 'tool_failed');
  assert.match(failed.error?.message ?? '', /ECONNREFUSED 10\.0\.4\.17:5432/);
  assert.deepEqual(
    events.flatMap((e) => (e.type === 'tool_rejected' ? [[e.code, e.callId]] : [])),
    [
      ['invalid_arguments', 'o1'],
      ['unknown_tool', 'd1'],
      ['invalid_json', 'k2'],
    ],
  );
  const rejectedArgs = events.find(
    (e) => e.type === 'tool_rejected' && e.code === 'invalid_arguments',
  );
  assert.ok(
    rejectedArgs?.type === 'tool_rejected' && rejectedArgs.detail.includes('internal_enum_a'),
  );
});

test('3d: срок инструмента — модель получает tool_timeout, инструмент получает сигнал отмены', async () => {
  let aborted = false;
  const hanging = tool('knowledge_search', 'knowledge.search', (_input, context) => {
    return new Promise((_, reject) => {
      context.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('aborted by loop'));
      });
    });
  });
  const inputs: StepInput[] = [];
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'Цены?' }],
    tools: [hanging],
    step: scripted(
      [{ toolCalls: [call('knowledge_search', { query: 'x' })] }, { text: 'Без поиска: …' }],
      inputs,
    ),
    authorize: allowAll,
    limits: { ...LIMITS, toolTimeoutMs: 30 },
  });
  assert.equal(result.stopReason, 'answer');
  assert.equal(aborted, true);
  const last = inputs[1]!.messages.at(-1);
  assert.ok(last?.role === 'tool' && last.content === TOOL_ERROR_MESSAGES.tool_timeout);
  for (const m of inputs[1]!.messages) if (m.role === 'tool') assert.ok(SAFE.has(m.content));
});

// ── Последний ответ без инструментов после лимита (3a) ──────────────────────────────────────

/** Модель всё время зовёт инструмент; на шаге с `toolChoice: 'none'` отвечает текстом. */
function stubborn(costUsd: number, inputs: StepInput[], toolCalls = 1) {
  return async (input: StepInput): Promise<StepResult> => {
    inputs.push({ ...input, messages: [...input.messages] });
    const final = input.toolChoice === 'none';
    return {
      text: final ? 'Доставка — 1 500 ₸. Остальное уточнит сотрудник.' : '',
      // Шаг без инструментов, который всё же вернул вызов, — вызов игнорируется.
      toolCalls: Array.from({ length: toolCalls }, (_, i) =>
        call('knowledge_search', { query: `q${input.step}-${i}` }, `c${input.step}_${i}`),
      ),
      usage: { inputTokens: 10, outputTokens: 5 },
      costUsd,
      creditsUsd: Math.min(costUsd, Math.max(0, input.maxChargeUsd)),
      model: { id: 'm', name: 'M' },
    };
  };
}

test('3a: лимит шагов — последний шаг без инструментов, посетитель получает ответ', async () => {
  const inputs: StepInput[] = [];
  let executed = 0;
  const counted = tool('knowledge_search', 'knowledge.search', async () => {
    executed += 1;
    return { content: 'Доставка — 1 500 ₸.' };
  });
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'Цены?' }],
    tools: [counted],
    step: stubborn(0.0001, inputs),
    authorize: allowAll,
    limits: { ...LIMITS, maxToolCalls: 100 },
    finalAnswer: true,
  });
  assert.equal(result.stopReason, 'max_steps');
  assert.equal(result.finalStep, true);
  assert.equal(result.text, 'Доставка — 1 500 ₸. Остальное уточнит сотрудник.');
  assert.equal(result.steps, LIMITS.maxSteps, 'последний шаг входит в maxSteps');
  assert.equal(inputs.length, LIMITS.maxSteps);
  assert.deepEqual(
    inputs.map((i) => i.toolChoice ?? 'auto'),
    ['auto', 'auto', 'auto', 'auto', 'auto', 'none'],
  );
  assert.equal(executed, LIMITS.maxSteps - 1, 'вызов последнего шага не выполняется');
});

test('3a: потолок кредитов — бюджет на последний шаг зарезервирован, сумма не больше 0,03 $', async () => {
  // Шаг ≈ 0,010 $ (модель уровня Sonnet, промпт бота ~4 тыс. токенов): без резерва после трёх шагов
  // с инструментами остаток 0 → «budget» и пустой ответ при списанных 0,03 $.
  const inputs: StepInput[] = [];
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'Цены?' }],
    tools: [search],
    step: stubborn(0.01, inputs),
    authorize: allowAll,
    limits: { ...LIMITS, maxToolCalls: 100 },
    finalAnswer: true,
  });
  assert.equal(result.stopReason, 'budget');
  assert.equal(result.finalStep, true);
  assert.ok(result.text.length > 0);
  assert.deepEqual(
    inputs.map((i) => [i.maxChargeUsd, i.toolChoice ?? 'auto']),
    [
      [0.03, 'auto'],
      [0.01, 'auto'], // остаток 0,02 − резерв 0,01 (самый дорогой шаг)
      [0.01, 'none'], // остаток 0,01 − резерв 0,01 = 0 → последний шаг на весь остаток
    ],
  );
  assert.equal(result.creditsUsd, 0.03);
  assert.equal(result.costUsd, 0.03);
});

test('3a: потолок кредитов — шаги дороже потолка: последний шаг получает остаток, сумма = 0,03 $', async () => {
  const inputs: StepInput[] = [];
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'Цены?' }],
    tools: [search],
    step: stubborn(0.012, inputs),
    authorize: allowAll,
    limits: { ...LIMITS, maxToolCalls: 100 },
    finalAnswer: true,
  });
  assert.equal(result.stopReason, 'budget');
  assert.equal(result.finalStep, true);
  assert.deepEqual(
    inputs.map((i) => [i.maxChargeUsd, i.toolChoice ?? 'auto']),
    [
      [0.03, 'auto'],
      [0.006, 'auto'],
      [0.012, 'none'],
    ],
  );
  assert.equal(result.creditsUsd, 0.03);
  assert.ok(result.creditsUsd <= LIMITS.budgetUsd);
});

test('3a: на последний шаг нет и минимального бюджета — остановка budget без текста', async () => {
  const inputs: StepInput[] = [];
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'Цены?' }],
    tools: [search],
    step: stubborn(0.0298, inputs),
    authorize: allowAll,
    limits: { ...LIMITS, maxToolCalls: 100 },
    finalAnswer: true,
  });
  assert.equal(result.stopReason, 'budget');
  assert.equal(result.finalStep, false);
  assert.equal(result.text, '');
  assert.equal(inputs.length, 1, 'остаток 0,0002 $ меньше минимального шага');
  assert.equal(result.creditsUsd, 0.0298);
});

test('3a: сбои инструмента подряд — последний шаг видит безопасные ошибки и отвечает', async () => {
  const broken = tool('knowledge_search', 'knowledge.search', async () => {
    throw new Error('index down at 10.0.0.9');
  });
  const inputs: StepInput[] = [];
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'Цены?' }],
    tools: [broken],
    step: stubborn(0.001, inputs),
    authorize: allowAll,
    limits: LIMITS,
    finalAnswer: true,
  });
  assert.equal(result.stopReason, 'failures');
  assert.equal(result.finalStep, true);
  assert.equal(inputs.length, LIMITS.maxConsecutiveFailures + 1);
  assert.equal(inputs.at(-1)!.toolChoice, 'none');
  const toolMessages = inputs.at(-1)!.messages.filter((m) => m.role === 'tool');
  assert.deepEqual(
    toolMessages.map((m) => m.role === 'tool' && m.content),
    [TOOL_ERROR_MESSAGES.tool_failed, TOOL_ERROR_MESSAGES.tool_failed],
  );
});

test('3a: лимит вызовов посреди шага — невыполненные вызовы получают not_executed, затем ответ', async () => {
  const inputs: StepInput[] = [];
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'Цены?' }],
    tools: [search],
    step: stubborn(0.001, inputs, 3),
    authorize: allowAll,
    limits: { ...LIMITS, maxToolCalls: 2 },
    finalAnswer: true,
  });
  assert.equal(result.stopReason, 'max_tool_calls');
  assert.equal(result.finalStep, true);
  const final = inputs.at(-1)!;
  assert.equal(final.toolChoice, 'none');
  const callIds = final.messages.flatMap((m) =>
    m.role === 'assistant' ? (m.tool_calls ?? []).map((c) => c.id) : [],
  );
  const answered = final.messages.flatMap((m) =>
    m.role === 'tool' ? [[m.tool_call_id, m.content]] : [],
  );
  assert.deepEqual(
    answered.map(([id]) => id),
    callIds,
    'у каждого вызова есть результат',
  );
  assert.equal(answered.at(-1)?.[1], TOOL_ERROR_MESSAGES.not_executed);
});

test('3a: ошибка последнего шага — причина лимита остаётся, текста нет, ошибка записана', async () => {
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'Цены?' }],
    tools: [search],
    step: async (input) => {
      if (input.toolChoice === 'none') throw new StepError('provider_error', 'all models failed');
      return stubborn(0.0001, [])(input);
    },
    authorize: allowAll,
    limits: { ...LIMITS, maxToolCalls: 100 },
    finalAnswer: true,
  });
  assert.equal(result.stopReason, 'max_steps');
  assert.equal(result.finalStep, false);
  assert.equal(result.text, '');
  assert.equal(result.error?.code, 'provider_error');
});

test('3a: без finalAnswer поведение прежнее (ядро по умолчанию)', async () => {
  const inputs: StepInput[] = [];
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'Цены?' }],
    tools: [search],
    step: stubborn(0.0001, inputs),
    authorize: allowAll,
    limits: { ...LIMITS, maxToolCalls: 100 },
  });
  assert.equal(result.stopReason, 'max_steps');
  assert.equal(result.finalStep, false);
  assert.ok(inputs.every((i) => i.toolChoice === undefined));
});
