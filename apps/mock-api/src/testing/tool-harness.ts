/**
 * Стенд для тестов инструментов: настоящий AI Gateway и настоящий журнал кредитов, подделан только
 * провайдер моделей. Общий для тестов исполнителя, попыток и прогресса.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CircuitBreaker } from '../ai/circuit-breaker.js';
import { AIGateway } from '../ai/gateway.js';
import type {
  AIProvider,
  ProviderRequestOptions,
  ProviderResponse,
  ProviderStreamCallbacks,
} from '../ai/gateway-types.js';
import { ModelRegistry } from '../ai/model-registry.js';
import { ProviderManager } from '../ai/providers/provider-factory.js';
import { config } from '../config.js';
import { defaultConfig } from '../builder/service.js';
import { MemoryBuilderStore } from '../builder/store.js';
import { MemoryAttemptStore } from '../builder/tools/attempt-store.js';
import { AttemptService } from '../builder/tools/attempts.js';
import { ToolExecutor, type ToolCaller } from '../builder/tools/executor.js';
import { MemoryMaterialStore } from '../builder/tools/material-store.js';
import { buildMaterial } from '../builder/tools/materials.js';
import { MemoryRunStore } from '../builder/tools/run-store.js';
import { memoryCredits, setBalance } from '../services/credits-fixture.js';
import { UsageStore } from '../store/usage-store.js';
import { STUDY_CONFIG, toolSolution } from './builder-fixtures.js';

export const NOW = new Date('2026-11-05T10:00:00.000Z');

export type Harness = Awaited<ReturnType<typeof harness>>;

export type Reply =
  | { text: string; cost?: number }
  | { error: Error }
  /** Ответ ждёт, пока тест не отпустит его. */
  | { wait: Promise<void>; text: string; cost?: number };

export interface ProviderCall {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}

export const notesJson = (sources = ['S1']) =>
  JSON.stringify({
    title: 'Клетка',
    summary: 'Строение клетки.',
    sections: [
      {
        heading: 'Ядро',
        points: ['Ядро хранит ДНК'],
        keyTerms: [{ term: 'ДНК', definition: 'Носитель наследственности' }],
        sources,
      },
    ],
  });

export function provider(replies: Reply[], calls: ProviderCall[]): AIProvider {
  return {
    type: 'openrouter',
    name: 'FakeOpenRouter',
    isAvailable: () => true,
    async generateText() {
      throw new Error('не используется');
    },
    async streamText(options: ProviderRequestOptions, cb: ProviderStreamCallbacks) {
      calls.push({
        model: options.model,
        system: String(
          options.systemPrompt ?? options.messages.find((m) => m.role === 'system')?.content ?? '',
        ),
        user: options.messages
          .filter((m) => m.role === 'user')
          .map((m) => m.content)
          .join('\n'),
        maxTokens: options.maxTokens,
      });
      const reply = replies.shift() ?? { text: notesJson(), cost: 0.002 };
      if ('error' in reply) throw reply.error;
      if ('wait' in reply) await reply.wait;
      cb.onDelta(reply.text);
      return {
        content: reply.text,
        usage: { inputTokens: 3000, outputTokens: 800 },
        finishReason: 'stop',
        ...(reply.cost !== undefined ? { cost: reply.cost } : {}),
      } satisfies ProviderResponse;
    },
  } as AIProvider;
}

export async function harness(
  options: { balanceCredits?: number; replies?: Reply[]; registry?: ModelRegistry } = {},
) {
  const builder = new MemoryBuilderStore();
  const solutionOf = (ownerId: string, id: string) => builder.getSolution(ownerId, id);
  const materials = new MemoryMaterialStore(solutionOf);
  const runs = new MemoryRunStore(solutionOf);
  const attempts = new MemoryAttemptStore((ownerId, solutionId, id) =>
    runs.get(ownerId, solutionId, id),
  );
  const usage = new UsageStore(join(mkdtempSync(join(tmpdir(), 'ketner-tools-')), 'usage.json'));
  const credits = memoryCredits();
  setBalance(credits, 'alice', 'credits', options.balanceCredits ?? 1000);
  const calls: ProviderCall[] = [];
  const providers = new ProviderManager();
  providers.setProvider('openrouter', provider(options.replies ?? [], calls));
  const registry = options.registry ?? new ModelRegistry();
  const gateway = new AIGateway({
    registry,
    providers,
    usageStore: usage,
    aiConfig: config.ai,
    circuitBreaker: new CircuitBreaker({ failureThreshold: 50, cooldownMs: 1 }),
    useMockEngine: false,
    credits,
  });
  let now = NOW;
  const executor = new ToolExecutor({
    runs,
    materials,
    solutions: builder,
    gateway,
    balanceUsd: (userId, plan) => credits.balance(userId, plan).remainingUsd,
    usage,
    attempts,
    registry,
    now: () => now,
  });
  const attemptService = new AttemptService({ attempts, runs, executor, now: () => now });
  const version = (solutionId: string) => ({ solutionId, number: 1, createdAt: NOW.toISOString() });
  await builder.createSolution(
    toolSolution('tool', 'alice'),
    { ...version('tool'), config: STUDY_CONFIG },
    [],
  );
  await builder.createSolution(
    toolSolution('tool-2', 'alice'),
    { ...version('tool-2'), config: STUDY_CONFIG },
    [],
  );
  await builder.createSolution(
    toolSolution('tool-3', 'alice'),
    { ...version('tool-3'), config: STUDY_CONFIG },
    [],
  );
  await builder.createSolution(
    { ...toolSolution('assistant', 'alice'), type: 'assistant', template: 'personal_assistant' },
    { ...version('assistant'), config: defaultConfig('Помощник', 'ru') },
    [],
  );
  const addMaterial = async (solutionId: string, texts: string[], id = `m-${solutionId}`) => {
    const built = buildMaterial({
      name: 'Биология.pdf',
      format: 'pdf',
      sizeBytes: 1000,
      sections: texts.map((text, i) => ({ label: `Стр. ${i + 1}`, text })),
    });
    assert.ok(built.ok);
    const { ok: _ok, ...rest } = built;
    await materials.add({
      id,
      solutionId,
      ownerId: 'alice',
      createdAt: NOW.toISOString(),
      ...rest,
    });
    return id;
  };
  for (const id of ['tool', 'tool-2', 'tool-3']) {
    await addMaterial(id, ['Клетка — основная единица живого.', 'Ядро хранит ДНК.']);
  }
  return {
    executor,
    attemptService,
    attempts,
    runs,
    materials,
    usage,
    credits,
    calls,
    addMaterial,
    balance: () => credits.balance('alice', 'credits').remainingUsd,
    setNow: (value: Date) => {
      now = value;
    },
  };
}

export const alice: ToolCaller = {
  userId: 'alice',
  plan: 'credits',
  isVip: false,
  anonymous: false,
  language: 'ru',
};
export const input = (solutionId = 'tool') => ({
  subject: 'Биология',
  materials: [{ id: `m-${solutionId}` }],
});

let keySeq = 0;
export const key = () => `key-${Date.now()}-${(keySeq += 1)}`;

export async function start(
  h: Harness,
  patch: Partial<Parameters<ToolExecutor['start']>[2]> = {},
  solutionId = 'tool',
) {
  const quote = await h.executor.quote(alice, solutionId, 'notes', input(solutionId));
  assert.ok(quote.ok, JSON.stringify(quote));
  return h.executor.start(alice, solutionId, {
    operation: 'notes',
    input: input(solutionId),
    idempotencyKey: key(),
    acceptedMaxCredits: quote.quote.maxCredits,
    ...patch,
  });
}

export async function finished(h: Harness, solutionId: string, runId: string) {
  await h.executor.whenIdle();
  const found = await h.executor.get(alice, solutionId, runId);
  assert.ok(found.ok);
  return found.run;
}
