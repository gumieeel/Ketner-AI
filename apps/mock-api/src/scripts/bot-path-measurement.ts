/**
 * Сравнение двух путей ответа бота на одних и тех же записанных диалогах: прежний путь
 * (builder.answer) и путь платформы (ядро цикла, builder/bot-agent.ts). Чистая логика: выбор
 * диалогов, повтор ходов посетителя, сводка. Сеть, база и шлюз — в measure-bot-paths.ts.
 */

import { parseBotReply } from '../builder/bot-prompt.js';
import { BOT_HISTORY, BOT_REPLY_CAP_USD } from '../builder/bot-service.js';
import { toCredits } from '../services/entitlement.js';

export interface RecordedMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RecordedConversation {
  id: string;
  messages: RecordedMessage[];
}

/** Один ход посетителя: записанная история до него (как её видит бот) и сам вопрос. */
export interface Turn {
  conversationId: string;
  index: number;
  history: RecordedMessage[];
  question: string;
}

export type PathName = 'legacy' | 'platform';

export interface PathOutcome {
  text: string;
  offerContact: boolean;
  costUsd: number;
  creditsUsd: number;
  steps: number;
  toolCalls: number;
  stopReason: string;
  finalStep: boolean;
  errorCode: string | null;
  model: string | null;
  latencyMs: number;
}

export interface TurnResult {
  conversationId: string;
  index: number;
  question: string;
  /** Какой путь шёл первым (порядок чередуется, чтобы не было систематического сдвига во времени). */
  first: PathName;
  legacy: PathOutcome;
  platform: PathOutcome;
  /** Сходство ответов по словам (Жаккар, 0…1). */
  similarity: number;
}

/** Диалоги с хотя бы одним вопросом посетителя, по порядку, не больше `count`. */
export function pickConversations(
  conversations: RecordedConversation[],
  count: number,
): RecordedConversation[] {
  return conversations
    .filter((conversation) =>
      conversation.messages.some((m) => m.role === 'user' && m.content.trim()),
    )
    .slice(0, count);
}

/**
 * Ходы для повтора: первые `turnsPerConversation` вопросов посетителя каждого диалога. История —
 * записанные сообщения до вопроса, последние `BOT_HISTORY` (как у bot-service.send), поэтому оба пути
 * получают одинаковый вход независимо от того, что ответили раньше.
 */
export function turnsOf(
  conversations: RecordedConversation[],
  turnsPerConversation: number,
): Turn[] {
  const turns: Turn[] = [];
  for (const conversation of conversations) {
    let taken = 0;
    conversation.messages.forEach((message, position) => {
      if (message.role !== 'user' || !message.content.trim() || taken >= turnsPerConversation)
        return;
      turns.push({
        conversationId: conversation.id,
        index: taken,
        history: conversation.messages.slice(0, position).slice(-BOT_HISTORY),
        question: message.content,
      });
      taken += 1;
    });
  }
  return turns;
}

const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 1),
  );

export function similarity(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 && right.size === 0) return 1;
  let common = 0;
  for (const word of left) if (right.has(word)) common += 1;
  return Math.round((common / (left.size + right.size - common)) * 100) / 100;
}

/** Ответ пути без метки контакта; метка — в `offerContact`, как у bot-service. */
export function normalized(outcome: PathOutcome): PathOutcome {
  const parsed = parseBotReply(outcome.text);
  return {
    ...outcome,
    text: parsed.text,
    offerContact: outcome.offerContact || parsed.offerContact,
  };
}

export type Answerer = (turn: Turn, key: string) => Promise<Omit<PathOutcome, 'latencyMs'>>;

/** Повтор ходов на обоих путях; порядок путей чередуется от хода к ходу. */
export async function replay(
  turns: Turn[],
  paths: Record<PathName, Answerer>,
  onProgress?: (done: number, total: number) => void,
): Promise<TurnResult[]> {
  const results: TurnResult[] = [];
  for (const [n, turn] of turns.entries()) {
    const order: PathName[] = n % 2 === 0 ? ['legacy', 'platform'] : ['platform', 'legacy'];
    const outcomes = {} as Record<PathName, PathOutcome>;
    for (const path of order) {
      const started = performance.now();
      const outcome = await paths[path](turn, `${path}:${turn.conversationId}:${turn.index}`);
      outcomes[path] = normalized({
        ...outcome,
        latencyMs: Math.round(performance.now() - started),
      });
    }
    results.push({
      conversationId: turn.conversationId,
      index: turn.index,
      question: turn.question,
      first: order[0]!,
      legacy: outcomes.legacy,
      platform: outcomes.platform,
      similarity: similarity(outcomes.legacy.text, outcomes.platform.text),
    });
    onProgress?.(n + 1, turns.length);
  }
  return results;
}

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
};
const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 1e6) / 1e6;
const counts = (values: string[]) =>
  Object.entries(
    values.reduce<Record<string, number>>((acc, value) => {
      acc[value] = (acc[value] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => `${value} ${count}`)
    .join(', ');

export interface PathSummary {
  replies: number;
  errors: number;
  costUsd: number;
  creditsUsd: number;
  credits: number;
  costPerReplyUsd: number;
  maxCreditsPerReplyUsd: number;
  stepsMean: number;
  stepsMax: number;
  toolCalls: number;
  stopReasons: string;
  finalSteps: number;
  offerContact: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  models: string;
}

export function summarize(results: TurnResult[], path: PathName): PathSummary {
  const outcomes = results.map((result) => result[path]);
  const replies = outcomes.length;
  const costUsd = sum(outcomes.map((o) => o.costUsd));
  const creditsUsd = sum(outcomes.map((o) => o.creditsUsd));
  return {
    replies,
    errors: outcomes.filter((o) => o.errorCode).length,
    costUsd,
    creditsUsd,
    credits: toCredits(creditsUsd),
    costPerReplyUsd: replies ? Math.round((costUsd / replies) * 1e6) / 1e6 : 0,
    maxCreditsPerReplyUsd: Math.max(0, ...outcomes.map((o) => o.creditsUsd)),
    stepsMean: replies ? Math.round((sum(outcomes.map((o) => o.steps)) / replies) * 100) / 100 : 0,
    stepsMax: Math.max(0, ...outcomes.map((o) => o.steps)),
    toolCalls: outcomes.reduce((total, o) => total + o.toolCalls, 0),
    stopReasons: counts(outcomes.map((o) => o.stopReason)),
    finalSteps: outcomes.filter((o) => o.finalStep).length,
    offerContact: outcomes.filter((o) => o.offerContact).length,
    latencyP50Ms: percentile(
      outcomes.map((o) => o.latencyMs),
      50,
    ),
    latencyP95Ms: percentile(
      outcomes.map((o) => o.latencyMs),
      95,
    ),
    models: counts(outcomes.map((o) => o.model ?? '—')),
  };
}

const cell = (text: string, max = 160) =>
  text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, max) + (text.length > max ? '…' : '');

/** Сводка в Markdown: итоги путей, отличия ответов, таблица ходов. */
export function report(
  results: TurnResult[],
  meta: { solutionId: string; plan: string; conversations: number; startedAt: string },
): string {
  const legacy = summarize(results, 'legacy');
  const platform = summarize(results, 'platform');
  const rows: Array<[string, (s: PathSummary) => string | number]> = [
    ['Ответов', (s) => s.replies],
    ['Ошибок', (s) => s.errors],
    ['Себестоимость всего, $', (s) => s.costUsd],
    ['Себестоимость на ответ, $', (s) => s.costPerReplyUsd],
    ['Списано бы с владельца, $ (кредиты)', (s) => `${s.creditsUsd} (${s.credits})`],
    ['Максимум списания на ответ, $', (s) => s.maxCreditsPerReplyUsd],
    ['Шагов модели: среднее / максимум', (s) => `${s.stepsMean} / ${s.stepsMax}`],
    ['Вызовов инструментов', (s) => s.toolCalls],
    ['Причины остановки', (s) => s.stopReasons],
    ['Последний шаг без инструментов', (s) => s.finalSteps],
    ['Форма контакта', (s) => s.offerContact],
    ['Задержка p50 / p95, мс', (s) => `${s.latencyP50Ms} / ${s.latencyP95Ms}`],
    ['Модели', (s) => s.models],
  ];
  const ratio =
    legacy.costUsd > 0 ? Math.round((platform.costUsd / legacy.costUsd) * 100) / 100 : 0;
  const contactDiffers = results.filter((r) => r.legacy.offerContact !== r.platform.offerContact);
  const lowSimilarity = results.filter((r) => r.similarity < 0.3);
  const similarities = results.map((r) => r.similarity);
  const lines = [
    `# Бот: прежний путь и путь платформы`,
    ``,
    `Решение \`${meta.solutionId}\`, тариф владельца \`${meta.plan}\`, диалогов ${meta.conversations}, ходов ${results.length}. Начало: ${meta.startedAt}.`,
    `Деньги владельца не списывались (кредиты и учёт — в памяти); себестоимость — настоящая цена провайдера.`,
    ``,
    `| | прежний путь | путь платформы |`,
    `| --- | --- | --- |`,
    ...rows.map(([name, value]) => `| ${name} | ${value(legacy)} | ${value(platform)} |`),
    ``,
    `**Себестоимость платформы / прежнего пути: ×${ratio}.** Потолок ответа ${BOT_REPLY_CAP_USD} $: ${
      platform.maxCreditsPerReplyUsd <= BOT_REPLY_CAP_USD ? 'не превышен' : '**ПРЕВЫШЕН**'
    }.`,
    ``,
    `## Отличия ответов`,
    ``,
    `- Сходство по словам: медиана ${percentile(similarities, 50)}, ниже 0,3 — ${lowSimilarity.length} из ${results.length}.`,
    `- Форма контакта на одном пути и не на другом: ${contactDiffers.length}.`,
    ``,
    `## Ходы`,
    ``,
    `| диалог | ход | вопрос | прежний: ответ | платформа: ответ | сходство | $ прежний / платформа | шаги | причина (платформа) | контакт п/п | мс п/п |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
    ...results.map(
      (r) =>
        `| ${r.conversationId.slice(0, 8)} | ${r.index + 1} | ${cell(r.question, 80)} | ${cell(
          r.legacy.errorCode ? `[${r.legacy.errorCode}]` : r.legacy.text,
        )} | ${cell(r.platform.errorCode ? `[${r.platform.errorCode}]` : r.platform.text)} | ${
          r.similarity
        } | ${r.legacy.costUsd} / ${r.platform.costUsd} | ${r.platform.steps} | ${r.platform.stopReason}${
          r.platform.finalStep ? ' (последний шаг)' : ''
        } | ${r.legacy.offerContact ? 'да' : 'нет'} / ${r.platform.offerContact ? 'да' : 'нет'} | ${
          r.legacy.latencyMs
        } / ${r.platform.latencyMs} |`,
    ),
    ``,
  ];
  return lines.join('\n');
}
