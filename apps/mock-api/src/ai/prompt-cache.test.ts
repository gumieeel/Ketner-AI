import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { WorkspaceContext } from '../types.js';
import type { ProviderMessage } from './gateway-types.js';
import { UsageStore } from '../store/usage-store.js';
import { ContextOptimizer } from './context.js';
import { alignedWindowStart, promptCachePolicy, vendorOf } from './prompt-cache.js';
import { prepareMessages } from './providers/openrouter-provider.js';
import { buildWorkspaceContextBlock } from './workspace-context.js';

type Wire = ReturnType<typeof prepareMessages>[number];

const hasBreakpoint = (m: Wire): boolean =>
  Array.isArray(m.content) && m.content.some((part) => part.cache_control);
const textOf = (m: Wire): string =>
  Array.isArray(m.content) ? m.content.map((p) => p.text).join('') : m.content;

function workspace(): WorkspaceContext {
  const files = [
    { path: 'README.md', content: '# Demo\nПлатёжный сервис. '.repeat(40) },
    { path: 'package.json', content: '{"name":"demo","scripts":{"test":"node --test"}}' },
    ...Array.from({ length: 12 }, (_, i) => ({
      path: `src/module${i}.ts`,
      content: `export function handler${i}(input: string) {\n  return input.trim();\n}\n`.repeat(
        30,
      ),
    })),
    {
      path: 'src/billing/invoice-maker.ts',
      content: 'export function createInvoice() { return 42; }\n'.repeat(200),
    },
  ];
  return {
    type: 'local_folder',
    name: 'demo',
    filesCount: files.length,
    files: files.map((f) => ({ ...f, size: f.content.length })),
  };
}

/**
 * Запрос хода так, как его собирает шлюз: системный промпт + постоянная часть проекта, окно истории,
 * файлы под вопрос — в последнем сообщении пользователя.
 */
function buildTurn(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  summary?: string,
) {
  const question = history[history.length - 1].content;
  const { stableBlock, queryBlock } = buildWorkspaceContextBlock(workspace(), {
    language: 'ru',
    query: question,
    maxContentChars: 60_000,
  });
  const messages = ContextOptimizer.optimize(history, {
    maxMessages: 60,
    systemPrompt: `Ты Ketner AI.${stableBlock}`,
    language: 'ru',
    existingSummary: summary,
  });
  if (queryBlock) {
    const last = messages.findLastIndex((m) => m.role === 'user');
    messages[last] = { ...messages[last], content: `${queryBlock}\n\n${messages[last].content}` };
  }
  return messages;
}

/** Сколько входных токенов хода читается из кэша, записанного прошлыми ходами (Anthropic). */
function cachedTokensOf(current: Wire[], cachedPrefixes: Set<string>): number {
  let best = 0;
  let running = '';
  let tokens = 0;
  for (const message of current) {
    running += `${message.role}:${textOf(message)}\u0000`;
    tokens += ContextOptimizer.estimateTokens(textOf(message));
    if (cachedPrefixes.has(running)) best = tokens;
  }
  return best;
}

function rememberPrefixes(wire: Wire[], cachedPrefixes: Set<string>): void {
  let running = '';
  for (const message of wire) {
    running += `${message.role}:${textOf(message)}\u0000`;
    if (hasBreakpoint(message)) cachedPrefixes.add(running);
  }
}

test('вендоры: кто кэширует сам, кому нужны точки cache_control, кому кэш не положен', () => {
  assert.equal(vendorOf('anthropic/claude-opus-5.5'), 'anthropic');
  assert.equal(promptCachePolicy('anthropic/claude-opus-5.5').mode, 'explicit');
  assert.equal(promptCachePolicy('google/gemini-3.7-flash').mode, 'explicit-last');
  assert.equal(promptCachePolicy('openai/gpt-6.1-sol').mode, 'automatic');
  assert.equal(promptCachePolicy('nvidia/nemotron-3-ultra-550b-a55b:free').mode, 'none');
});

test('окно истории сдвигается шагами: начало истории совпадает несколько ходов подряд', () => {
  // 14, 16 и 18 сообщений (три хода подряд) → окно начинается с одного и того же места
  const starts = [14, 16, 18].map((n) => alignedWindowStart(n, 8, 60));
  assert.deepEqual(starts, [starts[0], starts[0], starts[0]]);
  for (let n = 9; n < 80; n++) {
    const start = alignedWindowStart(n, 8, 60);
    assert.ok(start >= 1, 'первое сообщение — якорь, в окно не входит');
    assert.ok(n - start >= 8 && n - start <= 13, `окно ${n - start} при ${n} сообщениях`);
  }
  // Лимит контекста тарифа сильнее шага: окно не длиннее maxMessages
  assert.equal(10 - alignedWindowStart(10, 8, 8), 8);
});

test('контекст проекта: системная часть одинакова для разных вопросов, файлы под вопрос — отдельно', () => {
  const first = buildWorkspaceContextBlock(workspace(), {
    language: 'ru',
    query: 'Почини src/billing/invoice-maker.ts',
    maxContentChars: 20_000,
  });
  const second = buildWorkspaceContextBlock(workspace(), {
    language: 'ru',
    query: 'Что делает handler3 в src/module3.ts?',
    maxContentChars: 20_000,
  });
  assert.equal(first.stableBlock, second.stableBlock, 'системный промпт не зависит от вопроса');
  assert.ok(first.queryBlock.includes('createInvoice'));
  assert.ok(!first.stableBlock.includes('--- File: src/billing/invoice-maker.ts'));
  assert.ok(first.block.startsWith(first.stableBlock));
});

test('Anthropic: три точки кэша — система, якорь, история перед вопросом', () => {
  const messages: ProviderMessage[] = [
    { role: 'system', content: 'Ты Ketner AI' },
    { role: 'system', content: '[Краткий контекст беседы: ...]' },
    { role: 'user', content: 'Якорь темы' },
    { role: 'user', content: 'Вопрос 5' },
    { role: 'assistant', content: 'Ответ 5' },
    { role: 'user', content: 'Вопрос 6' },
  ];
  const wire = prepareMessages('anthropic/claude-sonnet-5.5', messages);
  assert.deepEqual(
    wire.map(hasBreakpoint),
    [false, true, true, false, true, false],
    'точки: конец системных сообщений, якорь, сообщение перед вопросом',
  );
  assert.ok(wire.filter(hasBreakpoint).length <= 4, 'Anthropic принимает не больше 4 точек');
});

test('Gemini: одна точка и только на длинном префиксе (запись кэша платная)', () => {
  const short: ProviderMessage[] = [
    { role: 'system', content: 'Ты Ketner AI' },
    { role: 'user', content: 'Привет' },
    { role: 'assistant', content: 'Привет!' },
    { role: 'user', content: 'Как дела?' },
  ];
  assert.deepEqual(prepareMessages('google/gemini-3.7-flash', short), short);

  const long = [{ ...short[0], content: 'Код проекта. '.repeat(3000) }, ...short.slice(1)];
  const wire = prepareMessages('google/gemini-3.7-flash', long);
  assert.deepEqual(wire.map(hasBreakpoint), [false, false, true, false]);
});

test('диалог с проектом из 20 ходов: большая часть входа читается из кэша Claude', () => {
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const cachedPrefixes = new Set<string>();
  let summary: string | undefined;
  let input = 0;
  let cached = 0;

  for (let turn = 1; turn <= 20; turn++) {
    const question =
      turn % 3 === 0
        ? `Почини createInvoice в src/billing/invoice-maker.ts, шаг ${turn}`
        : `Что делает handler${turn % 12} в src/module${turn % 12}.ts? Ход ${turn}`;
    history.push({ role: 'user', content: question });
    const messages = buildTurn(history, summary);
    if (!summary) {
      summary = messages.find((m, i) => i > 0 && m.role === 'system')?.content;
    }
    const wire = prepareMessages('anthropic/claude-opus-5.5', messages);
    const total = messages.reduce((sum, m) => sum + ContextOptimizer.estimateTokens(m.content), 0);
    if (turn > 1) {
      input += total;
      cached += cachedTokensOf(wire, cachedPrefixes);
    }
    rememberPrefixes(wire, cachedPrefixes);
    history.push({
      role: 'assistant',
      content: `Ответ на ход ${turn}: ${'подробности '.repeat(60)}`,
    });
  }

  const share = cached / input;
  assert.ok(share >= 0.6, `из кэша читается ${(share * 100).toFixed(0)}% входа, ожидается ≥ 60%`);
});

test('UsageStore.getModelUsage30d: токены, доля кэша, цена запроса и доли тарифов по модели', () => {
  const store = new UsageStore(join(mkdtempSync(join(tmpdir(), 'ketner-m30-')), 'usage.json'));
  const base = {
    conversationId: 'c',
    provider: 'openrouter' as const,
    latencyMs: 100,
    status: 'success' as const,
  };
  // Opus: 12 длинных запросов, 9 из них с кэшем → кэш работает
  for (let i = 0; i < 12; i++) {
    store.recordUsage({
      ...base,
      userId: i < 8 ? 'pro-user' : 'ultra-user',
      modelId: 'claude-opus-5.5',
      inputTokens: 10_000,
      outputTokens: 2_000,
      cachedTokens: i < 9 ? 8_000 : 0,
      estimatedCost: 0.05,
    });
  }
  // Sol: длинные запросы без кэша → кэш не срабатывает
  for (let i = 0; i < 10; i++) {
    store.recordUsage({
      ...base,
      userId: 'pro-user',
      modelId: 'gpt-6.1-sol',
      inputTokens: 6_000,
      outputTokens: 1_000,
      estimatedCost: 0.02,
    });
  }
  // Семантический кэш и отказы в сводку не входят
  store.recordUsage({
    ...base,
    userId: 'pro-user',
    modelId: 'claude-opus-5.5',
    inputTokens: 10_000,
    outputTokens: 2_000,
    cachedTokens: 10_000,
    estimatedCost: 0,
    source: 'cache',
  });
  store.recordUsage({
    ...base,
    userId: 'pro-user',
    modelId: 'claude-opus-5.5',
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0,
    status: 'error',
  });

  const engines: Record<string, string> = {
    'claude-opus-5.5': 'anthropic/claude-opus-5.5',
    'gpt-6.1-sol': 'openai/gpt-6.1-sol',
  };
  const metrics = store.getModelUsage30d({
    userPlans: new Map([
      ['pro-user', 'pro'],
      ['ultra-user', 'ultra'],
    ]),
    describeModel: (id) => ({ name: id, engineId: engines[id] ?? id }),
  });

  const opus = metrics.find((m) => m.modelId === 'claude-opus-5.5');
  assert.ok(opus);
  assert.equal(opus.requests, 12);
  assert.equal(opus.vendor, 'anthropic');
  assert.equal(opus.avgInputTokens, 10_000);
  assert.equal(opus.avgOutputTokens, 2_000);
  assert.equal(opus.cachedTokenSharePct, 60);
  assert.equal(opus.cacheHitRequestsPct, 75);
  assert.equal(opus.cacheStatus, 'working');
  assert.equal(opus.avgCostPerRequest, 0.05);
  assert.deepEqual(opus.costShareByPlanPct, { pro: 66.7, ultra: 33.3 });

  const sol = metrics.find((m) => m.modelId === 'gpt-6.1-sol');
  assert.equal(sol?.cacheStatus, 'not_working');
  assert.equal(sol?.cachedTokenSharePct, 0);
  assert.equal(metrics[0].modelId, 'claude-opus-5.5', 'сортировка по расходу');
});
