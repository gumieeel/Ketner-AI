import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import type { StepInput, StepResult } from '../agent-core/types.js';
import { BotAgentRuntime } from '../builder/bot-agent.js';
import { BOT_REPLY_CAP_USD, BOT_REPLY_TOKENS } from '../builder/bot-service.js';
import { defaultConfig } from '../builder/service.js';
import { config } from '../config.js';
import { MemoryExecutionJournal } from '../platform/journal.js';
import { startTestServer } from '../testing/server.js';
import { createPlatformAdminRouter } from './platform-admin.js';

const VISITOR_TEXT = 'Мой заказ 48213 на имя Айгерим, телефон +7 701 555 0199';
const CONVERSATION = 'conv-private-7f3a';

async function withRouter(
  journal: MemoryExecutionJournal | null,
  body: (base: string) => Promise<void>,
  flag: Parameters<typeof createPlatformAdminRouter>[0] extends infer D
    ? D extends { flag?: infer F }
      ? F
      : never
    : never = { mode: 'list', solutionIds: ['sol-p'] },
) {
  const app = express();
  app.use('/api/admin/platform', createPlatformAdminRouter({ journal: () => journal, flag }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await body(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/platform`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const admin = { 'x-admin-key': config.adminApiKey };

/** Два ответа бота через настоящий рантайм: с поиском в знаниях и простой. */
async function seed(journal: MemoryExecutionJournal) {
  const reply = (text: string, toolCalls: StepResult['toolCalls'] = []): StepResult => ({
    text,
    toolCalls,
    usage: { inputTokens: 100, outputTokens: 20 },
    costUsd: 0.0012,
    creditsUsd: 0.0012,
    model: { id: 'ketner-mini', name: 'auto' },
  });
  const runtime = new BotAgentRuntime({
    gateway: { stream: async () => undefined } as never,
    journal,
    stepFactory: () => async (input: StepInput) =>
      input.step === 1 && input.messages.length === 1
        ? reply('', [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'knowledge_search', arguments: '{"query":"заказ"}' },
            },
          ])
        : reply('Заказ уточнит менеджер.'),
  });
  const config_ = defaultConfig('Бот', 'ru');
  const bot = {
    slug: 'proverka-bot',
    greeting: '',
    quickReplies: [],
    dailyCapCredits: 1000,
    corrections: [],
  };
  for (const [n, messages] of [
    [1, [{ role: 'user' as const, content: VISITOR_TEXT }]],
    [
      2,
      [
        { role: 'user' as const, content: VISITOR_TEXT },
        { role: 'assistant' as const, content: 'Секунду.' },
        { role: 'user' as const, content: 'А когда привезут?' },
      ],
    ],
  ] as const) {
    await runtime.answer({
      caller: {
        userId: 'owner-p',
        plan: 'credits',
        isVip: false,
        anonymous: false,
        language: 'ru',
      },
      solutionId: 'sol-p',
      version: 3,
      config: config_,
      bot,
      gatewayConversationId: `bot:${CONVERSATION}`,
      triggerKind: 'public_page',
      triggerRef: `conversation:${CONVERSATION}`,
      idempotencyKey: `bot_message:m${n}`,
      messages: [...messages],
      maxOutputTokens: BOT_REPLY_TOKENS,
      replyCapUsd: BOT_REPLY_CAP_USD,
    });
  }
  await runtime.drain();
}

test('platform admin: только администратор; роутер подключён в /api/admin/platform', async () => {
  const server = await startTestServer();
  try {
    const denied = await fetch(`${server.baseUrl}/api/admin/platform/executions?solution=sol-p`);
    assert.equal(denied.status, 403);
    const deniedView = await fetch(
      `${server.baseUrl}/api/admin/platform/executions/view?solution=sol-p`,
    );
    assert.equal(deniedView.status, 403);
    const allowed = await fetch(`${server.baseUrl}/api/admin/platform/executions?solution=sol-p`, {
      headers: admin,
    });
    assert.notEqual(allowed.status, 404, 'маршрут подключён');
    assert.notEqual(allowed.status, 403);
  } finally {
    await server.close();
  }
});

test('platform admin: последние исполнения — статус, причина, шаги, цена, длительность; без текста сообщений', async () => {
  const journal = new MemoryExecutionJournal();
  await seed(journal);
  await withRouter(journal, async (base) => {
    const res = await fetch(`${base}/executions?solution=sol-p`, { headers: admin });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const raw = await res.text();
    const body = JSON.parse(raw) as {
      flag: { mode: string; enabledForSolution: boolean };
      journal: string;
      summary: {
        count: number;
        byStopReason: Record<string, number>;
        creditsUsd: number;
        stepsMean: number;
      };
      executions: Array<Record<string, unknown>>;
    };
    assert.deepEqual(body.flag, { mode: 'list', enabledForSolution: true });
    assert.equal(body.journal, 'memory');
    assert.equal(body.summary.count, 2);
    assert.deepEqual(body.summary.byStopReason, { answer: 2 });
    assert.equal(body.summary.creditsUsd, 0.0036);
    assert.equal(body.summary.stepsMean, 1.5);
    const [latest, first] = body.executions;
    assert.deepEqual(Object.keys(first!).sort(), [
      'costUsd',
      'creditsUsd',
      'durationMs',
      'errorCode',
      'finalStep',
      'finishedAt',
      'id',
      'models',
      'offerContact',
      'replyChars',
      'solutionVersion',
      'startedAt',
      'status',
      'steps',
      'stopReason',
      'toolCalls',
      'triggerKind',
    ]);
    assert.deepEqual(
      [first!.status, first!.stopReason, first!.steps, first!.toolCalls, first!.models],
      [
        'succeeded',
        'answer',
        2,
        [{ tool: 'knowledge_search', ok: true }],
        ['ketner-mini', 'ketner-mini'],
      ],
    );
    assert.equal(latest!.steps, 1);
    assert.equal(typeof first!.durationMs, 'number');
    // Ни текста посетителя, ни id диалога.
    for (const leak of [
      VISITOR_TEXT,
      '48213',
      'Айгерим',
      'А когда привезут',
      CONVERSATION,
      'Заказ уточнит',
    ]) {
      assert.ok(!raw.includes(leak), `JSON не содержит «${leak}»`);
    }

    const view = await fetch(`${base}/executions/view?solution=sol-p&limit=10`, { headers: admin });
    assert.equal(view.status, 200);
    assert.match(view.headers.get('content-type') ?? '', /text\/html/);
    const html = await view.text();
    assert.match(html, /Путь платформы — решение sol-p/);
    assert.match(html, /<b>включён<\/b>/);
    assert.match(html, /knowledge_search/);
    for (const leak of [VISITOR_TEXT, '48213', CONVERSATION, 'Заказ уточнит']) {
      assert.ok(!html.includes(leak), `страница не содержит «${leak}»`);
    }

    const limited = (await (
      await fetch(`${base}/executions?solution=sol-p&limit=1`, { headers: admin })
    ).json()) as { executions: unknown[] };
    assert.equal(limited.executions.length, 1);
    const other = (await (
      await fetch(`${base}/executions?solution=sol-other`, { headers: admin })
    ).json()) as { executions: unknown[]; flag: { enabledForSolution: boolean } };
    assert.deepEqual([other.executions.length, other.flag.enabledForSolution], [0, false]);
  });
});

test('platform admin: неверный id решения — 400; без журнала — 503; выключенный флаг виден', async () => {
  await withRouter(
    new MemoryExecutionJournal(),
    async (base) => {
      const bad = await fetch(`${base}/executions?solution=${encodeURIComponent("x' OR 1=1")}`, {
        headers: admin,
      });
      assert.equal(bad.status, 400);
      const missing = await fetch(`${base}/executions`, { headers: admin });
      assert.equal(missing.status, 400);
      const html = await (
        await fetch(`${base}/executions/view?solution=sol-p`, { headers: admin })
      ).text();
      assert.match(html, /выключен — ответы идут прежним путём/);
      assert.match(html, /Исполнений пока нет/);
    },
    { mode: 'off' },
  );
  await withRouter(null, async (base) => {
    const res = await fetch(`${base}/executions?solution=sol-p`, { headers: admin });
    assert.equal(res.status, 503);
  });
});
