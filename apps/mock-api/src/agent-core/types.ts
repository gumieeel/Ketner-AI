/**
 * Ядро цикла агента (docs/AGENT_LOOP_CONVERGENCE.md): типы шага модели, инструментов, лимитов и итога.
 * Ядро не знает, кто его вызывает (бот, позже Ketner Code): шаг модели, инструменты и права приходят
 * снаружи.
 */

import type { AgentMessage, AgentToolCall, AgentToolDefinition } from '../ai/agent/agent-types.js';

/**
 * Что модель видит вместо ошибки инструмента: закрытый список безопасных сообщений. Текст исключения,
 * адреса, пути и коды внешних систем модели не передаются (их можно было бы пересказать посетителю);
 * полная ошибка уходит только в события прогона (`tool_rejected`, `tool_finished.error`) → журнал.
 */
export const TOOL_ERROR_MESSAGES = {
  unknown_tool: 'Error: unknown tool. Use only the listed tools.',
  not_allowed: 'Error: this action is not allowed for this agent.',
  invalid_json: 'Error: tool arguments are not valid JSON.',
  invalid_arguments: 'Error: invalid arguments. Check the tool parameters and try again.',
  tool_failed: 'Error: the tool failed. Try once more or answer without it.',
  tool_timeout: 'Error: the tool did not respond in time. Answer without it.',
  too_many_calls_in_step: 'Error: too many tool calls in one step; this call was not executed.',
  not_executed: 'Error: the tool call limit was reached; this call was not executed.',
} as const;
export type ToolErrorCode = keyof typeof TOOL_ERROR_MESSAGES;

export interface StepInput {
  /** Номер шага, с 1. */
  step: number;
  messages: AgentMessage[];
  tools: AgentToolDefinition[];
  /** Остаток потолка списания за весь прогон, $: шаг не может списать больше. */
  maxChargeUsd: number;
  signal: AbortSignal;
  /** `none` — последний шаг без инструментов (`LoopRun.finalAnswer`): модель обязана ответить текстом. */
  toolChoice?: 'none';
}

export interface StepResult {
  text: string;
  toolCalls: AgentToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  /** Полная себестоимость шага, $ (учёт шлюза). */
  costUsd: number;
  /** Сколько списано с кредитов, $ (не больше `maxChargeUsd`). */
  creditsUsd: number;
  model: { id: string; name: string } | null;
}

/** Один шаг модели. В production — AIGateway с `agentStep` (agent-core/gateway-step.ts). */
export type ModelStep = (input: StepInput) => Promise<StepResult>;

/** Шаг модели не удался (шлюз перебрал запасные модели и ответил ошибкой). */
export class StepError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StepError';
  }
}

export interface ToolOutcome {
  /** Результат для модели (строка в сообщении `tool`). */
  content: string;
  /**
   * Инструмент передаёт разговор человеку: цикл останавливается с причиной `escalated`.
   * `message` — ответ собеседнику, который модель передала в аргументах инструмента.
   */
  escalate?: { reason: string; message?: string };
  /** Короткие метаданные для журнала (без содержимого). */
  meta?: Record<string, unknown>;
}

export interface LoopTool {
  /** Имя для модели (буквы, цифры, `_`). */
  name: string;
  /** Действие из словаря platform/risk.ts: по нему проверяются права. */
  action: string;
  description: string;
  /** JSON Schema входа. */
  parameters: Record<string, unknown>;
  /** Проверка входа до вызова; ошибка уходит модели как результат инструмента. */
  parse(input: unknown): { ok: true; value: unknown } | { ok: false; error: string };
  execute(input: unknown, context: { step: number; signal: AbortSignal }): Promise<ToolOutcome>;
}

/** Решение о праве на действие: проверяется перед каждым вызовом инструмента. */
export type AuthorizeAction = (
  action: string,
) => { allowed: true; authorizedBy: string } | { allowed: false; reason: string };

export interface LoopLimits {
  maxSteps: number;
  /** Всего вызовов инструментов за прогон. */
  maxToolCalls: number;
  /** Вызовов за один шаг; лишние получают ошибку и не выполняются. */
  maxToolCallsPerStep: number;
  /** Сбоев инструментов подряд, после которых прогон останавливается. */
  maxConsecutiveFailures: number;
  timeoutMs: number;
  /** Срок одного вызова инструмента, мс; по истечении модель получает `tool_timeout`. */
  toolTimeoutMs?: number;
  /** Потолок списания за прогон, $ (у бота — 30 кредитов на ответ). */
  budgetUsd: number;
  /** Меньше этого остатка шаг не начинается, $. */
  minStepBudgetUsd: number;
}

export const STOP_REASONS = [
  'answer',
  'escalated',
  'max_steps',
  'max_tool_calls',
  'budget',
  'timeout',
  'cancelled',
  'failures',
  'error',
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export type LoopEvent =
  | { type: 'step_started'; step: number; maxChargeUsd: number; final: boolean }
  | {
      type: 'step_finished';
      step: number;
      costUsd: number;
      creditsUsd: number;
      toolCalls: number;
      model: string | null;
    }
  | { type: 'step_failed'; step: number; code: string }
  | { type: 'tool_denied'; step: number; tool: string; action: string; reason: string }
  /** Вызов отклонён до выполнения: неизвестный инструмент, неверный JSON или аргументы, лимит. */
  | {
      type: 'tool_rejected';
      step: number;
      tool: string;
      callId: string;
      code: ToolErrorCode;
      detail: string;
    }
  | {
      type: 'tool_started';
      step: number;
      tool: string;
      action: string;
      callId: string;
      authorizedBy: string;
    }
  | {
      type: 'tool_finished';
      step: number;
      tool: string;
      action: string;
      callId: string;
      ok: boolean;
      escalate: boolean;
      meta?: Record<string, unknown>;
      /** Полная ошибка инструмента — только для журнала; модель видит `TOOL_ERROR_MESSAGES[code]`. */
      error?: { code: ToolErrorCode; message: string };
    }
  | { type: 'stopped'; reason: StopReason };

export interface LoopRun {
  messages: AgentMessage[];
  tools: LoopTool[];
  step: ModelStep;
  authorize: AuthorizeAction;
  limits: LoopLimits;
  /** События по порядку; ошибка обработчика не останавливает прогон (уходит в `onHookError`). */
  onEvent?: (event: LoopEvent) => Promise<void> | void;
  onHookError?: (error: unknown, event: LoopEvent) => void;
  /** Подготовка сообщений перед шагом (например, сжатие контекста). */
  prepareMessages?: (messages: AgentMessage[], step: number) => AgentMessage[];
  signal?: AbortSignal;
  /**
   * Последний ответ без инструментов. Если прогон упирается в `max_steps`, `max_tool_calls`,
   * `budget` или `failures`, ядро делает ещё один шаг с `toolChoice: 'none'`, чтобы собеседник получил
   * ответ из уже собранного. Для него резервируется бюджет: со второго шага каждый шаг с инструментами
   * может списать не больше `остаток − max(minStepBudgetUsd, самый дорогой шаг прогона)`; последний
   * шаг входит в `maxSteps`. Причина остановки остаётся прежней (`max_steps`, …), `finalStep` = true.
   */
  finalAnswer?: boolean;
}

export interface LoopResult {
  stopReason: StopReason;
  /** Текст последнего шага модели (пустой, если шаг не ответил текстом). */
  text: string;
  /** Текст получен последним шагом без инструментов после лимита (`LoopRun.finalAnswer`). */
  finalStep: boolean;
  steps: number;
  toolCalls: Array<{ tool: string; ok: boolean }>;
  costUsd: number;
  creditsUsd: number;
  /** Модель последнего успешного шага. */
  model: { id: string; name: string } | null;
  escalation: { tool: string; reason: string; message?: string } | null;
  error: { code: string; message: string } | null;
}
