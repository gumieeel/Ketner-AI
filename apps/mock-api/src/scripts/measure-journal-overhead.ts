/**
 * Замер: сколько обращений к Postgres делает журнал исполнения на один ответ бота (путь платформы)
 * и сколько времени он добавляет до ответа посетителю.
 *
 * Модель поддельная и мгновенная (без сети и без денег): всё измеренное время — журнал. Обращения
 * считаются обёрткой над SqlRunner; `--rtt <мс>` добавляет задержку к каждому обращению, чтобы
 * показать вклад сетевой задержки до базы (у локального Postgres она ~0,1 мс).
 *
 * Запуск (база — одноразовая, схема создаётся и удаляется):
 *   TEST_DATABASE_URL=postgresql://… npx tsx src/scripts/measure-journal-overhead.ts [--runs 30] [--rtt 0,5,20]
 */

import { runMigrations } from '../db/migrate.js';
import { MIGRATIONS } from '../db/migration-list.js';
import type { SqlRunner } from '../code/postgres-driver.js';
import type { ModelStep, StepResult } from '../agent-core/types.js';
import { PostgresExecutionJournal } from '../platform/journal.js';
import { openTestSql } from '../testing/sql.js';
import { BotAgentRuntime, type BotAgentInput } from '../builder/bot-agent.js';
import { BOT_REPLY_CAP_USD, BOT_REPLY_TOKENS } from '../builder/bot-service.js';
import { defaultConfig } from '../builder/service.js';

const OWNER = 'owner-measure';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

interface Counter {
  runner: SqlRunner;
  count: () => number;
  /** Обращения, ответ на которые уже пришёл (ответ посетителю их ждал, если пришёл до него). */
  completed: () => number;
  setRtt: (ms: number) => void;
}

function counting(inner: SqlRunner): Counter {
  let queries = 0;
  let done = 0;
  let rtt = 0;
  return {
    runner: {
      async query<T>(text: string, params?: unknown[]) {
        queries += 1;
        if (rtt > 0) await new Promise((resolve) => setTimeout(resolve, rtt));
        try {
          return await inner.query<T>(text, params);
        } finally {
          done += 1;
        }
      },
    },
    count: () => queries,
    completed: () => done,
    setRtt: (ms) => {
      rtt = ms;
    },
  };
}

const reply = (text: string, toolCalls: StepResult['toolCalls'] = []): StepResult => ({
  text,
  toolCalls,
  usage: { inputTokens: 100, outputTokens: 20 },
  costUsd: 0.0003,
  creditsUsd: 0.0003,
  model: { id: 'fake', name: 'fake' },
});

/** Сценарии: ответ в один шаг; поиск в знаниях, затем ответ (два шага, один инструмент). */
const SCENARIOS: Record<string, () => ModelStep> = {
  'answer (1 step)': () => async () => reply('Доставка — 1 500 ₸.'),
  'tool + answer (2 steps)': () => async (input) =>
    input.step === 1
      ? reply('', [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'knowledge_search', arguments: '{"query":"доставка"}' },
          },
        ])
      : reply('Доставка — 1 500 ₸.'),
};

const config = { ...defaultConfig('Замер', 'ru'), knowledge: 'Доставка по Алматы — 1 500 ₸.' };
const bot = {
  slug: 'zamer',
  greeting: '',
  quickReplies: [],
  dailyCapCredits: 1000,
  corrections: [],
};

function input(n: number): BotAgentInput {
  return {
    caller: { userId: OWNER, plan: 'credits', isVip: false, anonymous: false, language: 'ru' },
    solutionId: 'sol-measure',
    version: 1,
    config,
    bot,
    gatewayConversationId: `bot:measure-${n}`,
    triggerKind: 'public_page',
    triggerRef: `conversation:measure-${n}`,
    idempotencyKey: `bot_message:measure-${n}-${Math.random().toString(36).slice(2)}`,
    messages: [{ role: 'user', content: 'Сколько стоит доставка?' }],
    maxOutputTokens: BOT_REPLY_TOKENS,
    replyCapUsd: BOT_REPLY_CAP_USD,
  };
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

async function main() {
  const sql = await openTestSql();
  if (!sql) throw new Error('TEST_DATABASE_URL is required (a throwaway database)');
  const runs = Number(arg('runs', '30'));
  const rtts = arg('rtt', '0,5,20').split(',').map(Number);
  try {
    await runMigrations(sql.db, MIGRATIONS);
    await sql.runner.query(
      `INSERT INTO solutions (id, user_id, type, status, name, current_version, active_version, template)
       VALUES ('sol-measure', $1, 'customer_bot', 'active', 'Замер', 1, 1, 'customer_bot')`,
      [OWNER],
    );
    await sql.runner.query(
      `INSERT INTO solution_versions (solution_id, number, config) VALUES ('sol-measure', 1, '{}')`,
    );
    const counter = counting(sql.runner);
    const errors: string[] = [];
    let n = 0;
    console.log(
      '| scenario | rtt ms | round trips before reply | round trips total | journal ms before reply (median) | journal ms total (median) |',
    );
    console.log('| --- | --- | --- | --- | --- | --- |');
    for (const [name, makeStep] of Object.entries(SCENARIOS)) {
      for (const rtt of rtts) {
        counter.setRtt(rtt);
        const runtime = new BotAgentRuntime({
          gateway: { stream: async () => undefined } as never,
          journal: new PostgresExecutionJournal(counter.runner),
          stepFactory: () => makeStep(),
          log: (message, details) => errors.push(`${message} ${JSON.stringify(details)}`),
        });
        const drain = (runtime as unknown as { drain?: () => Promise<void> }).drain?.bind(runtime);
        // Прогрев: первое включение агента (снимок спецификации, открытие включения) не в счёт.
        await runtime.answer(input((n += 1)));
        await drain?.();
        const before: number[] = [];
        const total: number[] = [];
        const blockingMs: number[] = [];
        const totalMs: number[] = [];
        for (let i = 0; i < runs; i += 1) {
          const q0 = counter.count();
          const c0 = counter.completed();
          const t0 = performance.now();
          const answer = await runtime.answer(input((n += 1)));
          const t1 = performance.now();
          const c1 = counter.completed();
          await drain?.();
          const t2 = performance.now();
          if (answer.error) throw new Error(`reply failed: ${answer.error.code}`);
          before.push(c1 - c0);
          total.push(counter.count() - q0);
          blockingMs.push(t1 - t0);
          totalMs.push(t2 - t0);
        }
        console.log(
          `| ${name} | ${rtt} | ${median(before)} | ${median(total)} | ${median(blockingMs).toFixed(1)} | ${median(totalMs).toFixed(1)} |`,
        );
      }
    }
    if (errors.length > 0) {
      console.error(`journal errors: ${errors.length}`);
      console.error(errors.slice(0, 5).join('\n'));
      process.exitCode = 1;
    }
  } finally {
    await sql.close();
  }
}

await main();
