/**
 * Вызов модели этапа анализа через существующий AI Gateway.
 *
 * Отдельного способа обращаться к провайдерам нет: выбор модели, предохранитель, сторож потока,
 * цена, списание кредитов и учёт — штатные. Здесь только: собрать ответ, разобрать JSON терпимым
 * парсером проверки ответов (services/answer-review.ts), проверить схемой и при ошибке один раз
 * попросить исправить. Результат, не прошедший схему со второй попытки, не выдумывается: этап
 * завершается ошибкой `model_output_invalid`.
 */

import type { z } from 'zod';
import type { AIGateway } from '../ai/gateway.js';
import type { GatewayRequest } from '../ai/gateway-types.js';
import { extractJsonObject } from '../services/answer-review.js';
import type { Language, PlanId } from '../types.js';
import type { StagePolicy } from './model-policy.js';
import { REPAIR_ECHO_CHARS, repairMessage } from './prompts.js';

export interface TaskCaller {
  userId: string;
  plan: PlanId;
  email?: string;
  isVip: boolean;
  anonymous: boolean;
}

export interface StructuredTaskInput<T> {
  gateway: Pick<AIGateway, 'stream'>;
  caller: TaskCaller;
  /** id запуска: попадает в учёт как `runId`, по нему считается фактическая стоимость. */
  taskId: string;
  conversationId: string;
  billing: 'user' | 'sponsored';
  /** Вид служебной задачи в учёте: этап анализа или проверка (Builder: черновик, судья). */
  kind?: 'discovery' | 'review' | 'tool';
  policy: StagePolicy;
  language: Language;
  systemPrompt: string;
  userMessage: string;
  schema: z.ZodType<T>;
  /** JSON для demo-режима без ключей (локально и в тестах). */
  templateOutput: string;
  signal?: AbortSignal;
  /** Таймаут ответа провайдера, мс. */
  providerTimeoutMs?: number;
}

export interface AttemptReport {
  costUsd: number;
  creditsUsd: number;
  valid: boolean;
  model?: { id: string; name: string };
  error?: string;
}

export type StructuredTaskResult<T> =
  | {
      ok: true;
      data: T;
      model: { id: string; name: string };
      attempts: AttemptReport[];
      costUsd: number;
      creditsUsd: number;
    }
  | {
      ok: false;
      code: string;
      message: string;
      attempts: AttemptReport[];
      costUsd: number;
      creditsUsd: number;
    };

interface GatewayOutcome {
  text: string;
  error?: { code: string; message: string };
  costUsd: number;
  creditsUsd: number;
  model?: { id: string; name: string };
}

async function callOnce(
  input: StructuredTaskInput<unknown>,
  messages: GatewayRequest['messages'],
  maxChargeUsd: number,
): Promise<GatewayOutcome> {
  const outcome: GatewayOutcome = { text: '', costUsd: 0, creditsUsd: 0 };
  await input.gateway.stream(
    {
      userId: input.caller.userId,
      userPlan: input.caller.plan,
      ...(input.caller.email ? { userEmail: input.caller.email } : {}),
      isVip: input.caller.isVip,
      isAnonymous: input.caller.anonymous,
      conversationId: input.conversationId,
      modelId: input.policy.modelId,
      messages,
      language: input.language,
      stream: true,
      strictModel: true,
      ...(input.signal ? { signal: input.signal } : {}),
      providerTimeoutMs: input.providerTimeoutMs ?? 90_000,
      task: {
        kind: input.kind ?? 'discovery',
        id: input.taskId,
        systemPrompt: input.systemPrompt,
        templateOutput: input.templateOutput,
        billing: input.billing,
        maxOutputTokens: input.policy.maxOutputTokens,
        reasoningEffort: input.policy.reasoningEffort,
        // С пользователя — не больше обещанного потолка этапа за все попытки.
        maxChargeUsd,
      },
    },
    {
      onDelta: (delta) => {
        outcome.text += delta;
      },
      onDone: (done) => {
        outcome.costUsd = done.costUsd ?? 0;
        outcome.creditsUsd = done.creditsUsd ?? 0;
        if (done.selectedModel) outcome.model = done.selectedModel;
      },
      onError: (error) => {
        outcome.error = error;
      },
    },
    () => input.signal?.aborted ?? false,
  );
  return outcome;
}

/** Коротко, что не так с ответом: для повторного запроса и журнала. */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function parse<T>(
  schema: z.ZodType<T>,
  raw: string,
): { ok: true; data: T } | { ok: false; issues: string } {
  const object = extractJsonObject(raw);
  if (!object) return { ok: false, issues: 'no JSON object found' };
  const result = schema.safeParse(object);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, issues: describeIssues(result.error) };
}

const sum = (attempts: AttemptReport[], key: 'costUsd' | 'creditsUsd'): number =>
  Math.round(attempts.reduce((total, attempt) => total + attempt[key], 0) * 1e6) / 1e6;

export async function runStructuredTask<T>(
  input: StructuredTaskInput<T>,
): Promise<StructuredTaskResult<T>> {
  const attempts: AttemptReport[] = [];
  const firstMessages: GatewayRequest['messages'] = [{ role: 'user', content: input.userMessage }];

  const first = await callOnce(
    input as StructuredTaskInput<unknown>,
    firstMessages,
    input.policy.capUsd,
  );
  if (first.error) {
    attempts.push({
      costUsd: first.costUsd,
      creditsUsd: first.creditsUsd,
      valid: false,
      error: first.error.code,
    });
    return {
      ok: false,
      code: first.error.code,
      message: first.error.message,
      attempts,
      costUsd: sum(attempts, 'costUsd'),
      creditsUsd: sum(attempts, 'creditsUsd'),
    };
  }
  const firstParsed = parse(input.schema, first.text);
  attempts.push({
    costUsd: first.costUsd,
    creditsUsd: first.creditsUsd,
    valid: firstParsed.ok,
    ...(first.model ? { model: first.model } : {}),
    ...(firstParsed.ok ? {} : { error: firstParsed.issues }),
  });
  if (firstParsed.ok) {
    return {
      ok: true,
      data: firstParsed.data,
      model: first.model ?? { id: input.policy.modelId, name: input.policy.modelId },
      attempts,
      costUsd: sum(attempts, 'costUsd'),
      creditsUsd: sum(attempts, 'creditsUsd'),
    };
  }
  if (input.signal?.aborted) {
    return failure('cancelled', input.language, attempts);
  }

  const repairMessages: GatewayRequest['messages'] = [
    ...firstMessages,
    { role: 'assistant', content: first.text.slice(0, REPAIR_ECHO_CHARS) },
    { role: 'user', content: repairMessage(input.language, firstParsed.issues) },
  ];
  const second = await callOnce(
    input as StructuredTaskInput<unknown>,
    repairMessages,
    Math.max(0, input.policy.capUsd - first.creditsUsd),
  );
  if (second.error) {
    attempts.push({
      costUsd: second.costUsd,
      creditsUsd: second.creditsUsd,
      valid: false,
      error: second.error.code,
    });
    return {
      ok: false,
      code: second.error.code,
      message: second.error.message,
      attempts,
      costUsd: sum(attempts, 'costUsd'),
      creditsUsd: sum(attempts, 'creditsUsd'),
    };
  }
  const secondParsed = parse(input.schema, second.text);
  attempts.push({
    costUsd: second.costUsd,
    creditsUsd: second.creditsUsd,
    valid: secondParsed.ok,
    ...(second.model ? { model: second.model } : {}),
    ...(secondParsed.ok ? {} : { error: secondParsed.issues }),
  });
  if (secondParsed.ok) {
    return {
      ok: true,
      data: secondParsed.data,
      model: second.model ??
        first.model ?? { id: input.policy.modelId, name: input.policy.modelId },
      attempts,
      costUsd: sum(attempts, 'costUsd'),
      creditsUsd: sum(attempts, 'creditsUsd'),
    };
  }
  console.warn(
    `[discovery] ${input.taskId}: ответ модели не прошёл схему дважды: ${secondParsed.issues}`,
  );
  return failure('model_output_invalid', input.language, attempts);
}

function failure<T>(
  code: 'model_output_invalid' | 'cancelled',
  language: Language,
  attempts: AttemptReport[],
): StructuredTaskResult<T> {
  const message =
    code === 'cancelled'
      ? language === 'en'
        ? 'The analysis was stopped.'
        : 'Анализ остановлен.'
      : language === 'en'
        ? 'The model returned a reply in the wrong format twice. Try again: the step will run once more.'
        : 'Модель дважды ответила не в том формате. Повторите: этап запустится ещё раз.';
  return {
    ok: false,
    code,
    message,
    attempts,
    costUsd: sum(attempts, 'costUsd'),
    creditsUsd: sum(attempts, 'creditsUsd'),
  };
}
