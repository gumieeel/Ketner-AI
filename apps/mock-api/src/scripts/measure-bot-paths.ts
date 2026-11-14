/**
 * Замер для владельца: одни и те же записанные диалоги бота — прежним путём и путём платформы, на
 * настоящей модели. Сводка: себестоимость, кредиты, шаги, задержка, причины остановки, отличия ответов.
 *
 * Что скрипт НЕ делает:
 * - не пишет в базу: подключение только для чтения (`default_transaction_read_only`), журнал
 *   исполнений — в памяти;
 * - не списывает кредиты владельца и не пишет учёт: кредиты и учёт шлюза — в памяти. Расход у
 *   провайдера (OpenRouter) настоящий — до 0,03 $ на ответ каждого пути.
 *
 * Запуск — там, где есть переменные окружения сервера (ключи провайдера), из apps/mock-api:
 *
 *   BOT_PLATFORM_RUNTIME=<id решения> DATABASE_URL=… npx tsx src/scripts/measure-bot-paths.ts \
 *     --solution <id решения> --plan <тариф владельца> [--conversations 20] [--turns 3] \
 *     [--save-conversations диалоги.json | --from-file диалоги.json] [--out каталог] --yes
 *
 * Без `--yes` — только выбор диалогов и оценка расхода, без вызовов модели. `--from-file` повторяет
 * ровно те же диалоги (сохранённые раньше через `--save-conversations`) без обращения к базе за ними.
 * Файлы диалогов и результатов содержат сообщения посетителей: не коммитить, удалить после разбора.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { AIGateway } from '../ai/gateway.js';
import { providerManager } from '../ai/providers/provider-factory.js';
import { BotAgentRuntime } from '../builder/bot-agent.js';
import { buildBotInstructions } from '../builder/bot-prompt.js';
import { BOT_REPLY_CAP_USD, BOT_REPLY_TOKENS } from '../builder/bot-service.js';
import { BuilderService, type BuilderCaller } from '../builder/service.js';
import { PostgresBuilderStore } from '../builder/store.js';
import { isToolConfig, type AssistantConfig, type BotSettings } from '../builder/types.js';
import type { SqlRunner } from '../code/postgres-driver.js';
import { config, parseBotPlatformRuntime } from '../config.js';
import { MemoryDiscoveryStore } from '../discovery/store.js';
import { MemoryExecutionJournal } from '../platform/journal.js';
import { memoryCredits, setBalance } from '../services/credits-fixture.js';
import { UsageStore } from '../store/usage-store.js';
import type { PlanId } from '../types.js';
import {
  pickConversations,
  replay,
  report,
  summarize,
  turnsOf,
  type Answerer,
  type RecordedConversation,
} from './bot-path-measurement.js';

const PLANS: PlanId[] = [
  'free',
  'credits',
  'gpt-pro',
  'claude-pro',
  'gemini-pro',
  'ultra',
  'plus',
  'pro',
];

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
function fail(message: string): never {
  console.error(`measure-bot-paths: ${message}`);
  process.exit(2);
}

async function readOnlyDatabase(): Promise<{ runner: SqlRunner; close: () => Promise<void> }> {
  const url = process.env.DATABASE_URL;
  if (!url) fail('DATABASE_URL is not set');
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, {
    max: 2,
    onnotice: () => {},
    connection: { default_transaction_read_only: true, application_name: 'measure-bot-paths' },
  });
  const runner: SqlRunner = {
    query: async <T>(text: string, params?: unknown[]) =>
      (await sql.unsafe(text, (params ?? []) as never[])) as unknown as T[],
  };
  const [mode] = await runner.query<{ transaction_read_only: string }>(
    'SHOW transaction_read_only',
  );
  if (mode?.transaction_read_only !== 'on') {
    await sql.end();
    fail('could not open a read-only database session');
  }
  return { runner, close: () => sql.end() };
}

async function main() {
  const solutionId = option('solution') ?? fail('--solution <id> is required');
  const plan = (option('plan') ?? fail(`--plan is required (${PLANS.join(', ')})`)) as PlanId;
  if (!PLANS.includes(plan)) fail(`unknown plan ${plan}`);
  const isVip = flag('vip');
  const conversationCount = Number(option('conversations') ?? 20);
  const turnsPerConversation = Number(option('turns') ?? 3);

  // Флаг включён ровно для этого решения — как при пробном включении для одного бота.
  const runtimeFlag = parseBotPlatformRuntime(process.env.BOT_PLATFORM_RUNTIME ?? '');
  if (
    runtimeFlag.mode !== 'list' ||
    runtimeFlag.solutionIds.length !== 1 ||
    runtimeFlag.solutionIds[0] !== solutionId
  ) {
    fail(
      `set BOT_PLATFORM_RUNTIME to exactly this solution id (${solutionId}); "all" and lists are refused`,
    );
  }

  const db = await readOnlyDatabase();
  try {
    const store = new PostgresBuilderStore(db.runner);
    const [row] = await db.runner.query<{ user_id: string }>(
      `SELECT user_id FROM solutions WHERE id = $1`,
      [solutionId],
    );
    if (!row) fail(`solution ${solutionId} not found`);
    const ownerId = row.user_id;
    const solution = await store.getSolution(ownerId, solutionId);
    if (!solution?.bot || solution.type !== 'customer_bot')
      fail(`${solutionId} is not a customer bot`);
    const versionNumber = solution.activeVersion ?? solution.currentVersion;
    const version = await store.getVersion(ownerId, solutionId, versionNumber);
    if (!version || isToolConfig(version.config))
      fail(`version ${versionNumber} has no bot config`);
    const botConfig = version.config as AssistantConfig;
    const bot = solution.bot as BotSettings;

    let conversations: RecordedConversation[];
    const fromFile = option('from-file');
    if (fromFile) {
      conversations = JSON.parse(readFileSync(fromFile, 'utf8')) as RecordedConversation[];
    } else {
      const listed = await store.listConversations(ownerId, solutionId, 200);
      conversations = [];
      for (const conversation of listed) {
        const messages = await store.listBotMessages(ownerId, solutionId, conversation.id);
        conversations.push({
          id: conversation.id,
          messages: messages
            .filter((m) => m.status === 'complete')
            .map((m) => ({ role: m.role, content: m.content })),
        });
      }
    }
    const picked = pickConversations(conversations, conversationCount);
    const savePath = option('save-conversations');
    if (savePath) writeFileSync(savePath, JSON.stringify(picked, null, 2));
    const turns = turnsOf(picked, turnsPerConversation);
    console.log(
      `solution ${solutionId}, version ${versionNumber}, plan ${plan}: ${picked.length} conversations, ${turns.length} turns`,
    );
    console.log(
      `worst-case provider spend: ${turns.length} turns × 2 paths × ${BOT_REPLY_CAP_USD} $ = ${(
        turns.length *
        2 *
        BOT_REPLY_CAP_USD
      ).toFixed(2)} $ (typical is far lower)`,
    );
    if (turns.length === 0) fail('no visitor messages to replay');
    if (!flag('yes')) {
      console.log('dry run: add --yes to call the model');
      return;
    }
    if (!providerManager.getAll().some((provider) => provider.isAvailable())) {
      fail('no model provider is configured (provider keys are missing in this environment)');
    }

    // Шлюз как у сервера, но кредиты и учёт — в памяти: владелец ничего не платит.
    const credits = memoryCredits();
    setBalance(credits, ownerId, plan, 1_000_000);
    const usage = new UsageStore(join(mkdtempSync(join(tmpdir(), 'measure-bot-')), 'usage.json'));
    const gateway = new AIGateway({
      usageStore: usage,
      aiConfig: config.ai,
      credits,
      useMockEngine: false,
    });
    const builder = new BuilderService({
      store,
      discovery: new MemoryDiscoveryStore(),
      gateway,
      balanceUsd: () => 1_000,
    });
    const journal = new MemoryExecutionJournal();
    const platform = new BotAgentRuntime({ gateway, journal });
    const caller: BuilderCaller = {
      userId: ownerId,
      plan,
      isVip,
      anonymous: false,
      language: botConfig.language,
    };
    const dialog = (turn: {
      history: Array<{ role: 'user' | 'assistant'; content: string }>;
      question: string;
    }) => [...turn.history, { role: 'user' as const, content: turn.question }];

    const legacyPath: Answerer = async (turn, key) => {
      // Ровно вызов bot-service.answerBot при выключенном флаге.
      const answer = await builder.answer(
        caller,
        null,
        `bot:measure:${key}`,
        buildBotInstructions(botConfig, bot),
        dialog(turn),
        {
          solutionId,
          maxOutputTokens: BOT_REPLY_TOKENS,
          maxChargeUsd: BOT_REPLY_CAP_USD,
          replaceSystemPrompt: true,
        },
      );
      return {
        text: answer.text,
        offerContact: false,
        costUsd: answer.costUsd,
        creditsUsd: answer.creditsUsd,
        steps: answer.model || answer.costUsd > 0 ? 1 : 0,
        toolCalls: 0,
        stopReason: answer.error ? 'error' : 'answer',
        finalStep: false,
        errorCode: answer.error?.code ?? null,
        model: answer.model?.id ?? null,
      };
    };
    const platformPath: Answerer = async (turn, key) => {
      const answer = await platform.answer({
        caller,
        solutionId,
        version: versionNumber,
        config: botConfig,
        bot,
        gatewayConversationId: `bot:measure:${key}`,
        triggerKind: 'manual',
        triggerRef: `measure:${key}`,
        idempotencyKey: `measure:${key}:${Date.now()}`,
        messages: dialog(turn),
        maxOutputTokens: BOT_REPLY_TOKENS,
        replyCapUsd: BOT_REPLY_CAP_USD,
      });
      await platform.drain();
      const execution = [...journal.executions.values()].find(
        (e) => e.triggerRef === `measure:${key}`,
      );
      const meta = (execution?.outputMeta ?? {}) as {
        steps?: number;
        toolCalls?: unknown[];
        finalStep?: boolean;
      };
      return {
        text: answer.text,
        offerContact: answer.offerContact,
        costUsd: answer.costUsd,
        creditsUsd: answer.creditsUsd,
        steps: meta.steps ?? 0,
        toolCalls: meta.toolCalls?.length ?? 0,
        stopReason: execution?.stopReason ?? 'unknown',
        finalStep: meta.finalStep === true,
        errorCode: answer.error?.code ?? null,
        model: answer.model?.id ?? null,
      };
    };

    const startedAt = new Date().toISOString();
    const results = await replay(
      turns,
      { legacy: legacyPath, platform: platformPath },
      (done, total) => process.stdout.write(`\r${done}/${total} turns`),
    );
    process.stdout.write('\n');

    const out = resolve(option('out') ?? `bot-path-measurement-${startedAt.replace(/[:.]/g, '-')}`);
    mkdirSync(out, { recursive: true });
    writeFileSync(
      join(out, 'results.json'),
      JSON.stringify({ solutionId, plan, startedAt, results }, null, 2),
    );
    const summary = report(results, { solutionId, plan, conversations: picked.length, startedAt });
    writeFileSync(join(out, 'summary.md'), summary);
    const legacy = summarize(results, 'legacy');
    const platformSummary = summarize(results, 'platform');
    console.log(
      `legacy: ${legacy.costUsd} $ (${legacy.credits} credits), platform: ${platformSummary.costUsd} $ (${platformSummary.credits} credits)`,
    );
    console.log(
      `written: ${join(out, 'summary.md')} and results.json (contain visitor messages; do not commit)`,
    );
  } finally {
    await db.close();
  }
}

await main();
