/**
 * Типы агентского режима: запросы с вызовом инструментов (tool calling).
 *
 * Сервер сам инструменты не исполняет. Модель отвечает либо текстом, либо просьбой вызвать функцию
 * (`tool_calls`); функцию исполняет клиент (CLI-агент `ketner`, IDE) на компьютере пользователя и
 * присылает результат сообщением роли `tool`. Формат совпадает с OpenAI Chat Completions, поэтому
 * подходят и сторонние клиенты (Cursor, Continue, Cline).
 */

import type { ReasoningEffort } from '../gateway-types.js';

export interface AgentToolCall {
  id: string;
  type: 'function';
  function: { name: string; /** JSON-строка аргументов. */ arguments: string };
}

export type AgentMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: AgentToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface AgentToolDefinition {
  type: 'function';
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}

export type AgentToolChoice =
  'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };

/** Что провайдер присылает по мере генерации. */
export type AgentStreamEvent =
  | { kind: 'content'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool_call'; index: number; id?: string; name?: string; argumentsDelta?: string };

export interface AgentProviderRequest {
  /** Идентификатор модели у провайдера (например, `xiaomi/mimo-v2.6-pro`). */
  model: string;
  messages: AgentMessage[];
  tools?: AgentToolDefinition[];
  toolChoice?: AgentToolChoice;
  maxTokens: number;
  temperature?: number;
  reasoning?: { effort: ReasoningEffort } | { enabled: boolean };
  signal?: AbortSignal;
}

export interface AgentProviderResult {
  content: string;
  toolCalls: AgentToolCall[];
  finishReason: 'stop' | 'length' | 'tool_calls' | 'cancelled' | 'error';
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
    reasoningTokens?: number;
  };
  /** Фактическая цена от провайдера в USD. */
  cost?: number;
  /** Модель, которая реально ответила. */
  model?: string;
}

/** Провайдер, умеющий вызов функций. Реализует OpenRouterProvider. */
export interface AgentCapableProvider {
  streamAgent(
    request: AgentProviderRequest,
    hooks: { onEvent: (event: AgentStreamEvent) => void; isCancelled: () => boolean },
  ): Promise<AgentProviderResult>;
}

export function isAgentCapable(provider: unknown): provider is AgentCapableProvider {
  return Boolean(provider) && typeof (provider as AgentCapableProvider).streamAgent === 'function';
}
