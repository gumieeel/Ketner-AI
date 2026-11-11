/**
 * СПАЙК T4.0: инструменты бота для клиентов. Одни и те же для Mastra и для собственного цикла.
 *
 * Перед каждым вызовом — проверка: действие разрешено в AgentSpec (allowedActions) и по риску не
 * требует одобрения (platform/risk.ts). Риск задаёт код, а не спецификация.
 */

import type { AgentToolDefinition } from '../../ai/agent/agent-types.js';
import { legacyApprovalPolicy, type AgentSpec } from '../../platform/agent-spec.js';
import { approvalRequirement, isActionId, type ActionId } from '../../platform/risk.js';

export interface BotTool {
  action: ActionId;
  /** Имя для модели: в именах функций у провайдеров точки недопустимы. */
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(input: unknown): string;
}

/** Поиск в знаниях владельца (`knowledge.search`, риск LOW: чтение внутри Ketner). */
export function knowledgeSearchTool(spec: AgentSpec): BotTool {
  const sentences = spec.knowledge.inline
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return {
    action: 'knowledge.search',
    name: 'knowledge_search',
    description: 'Ищет ответ в знаниях владельца бизнеса: цены, доставка, условия.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Что искать' } },
      required: ['query'],
      additionalProperties: false,
    },
    execute(input) {
      const query = String((input as { query?: unknown } | null)?.query ?? '').toLowerCase();
      const words = query.split(/\s+/).filter((word) => word.length > 2);
      const found = sentences.filter((sentence) =>
        words.some((word) => sentence.toLowerCase().includes(word.slice(0, 5))),
      );
      return found.length > 0 ? found.join('\n') : 'Ничего не найдено.';
    },
  };
}

export class ToolDeniedError extends Error {}

/** Инструменты, которые агенту можно вызвать сразу (без одобрения человеком). */
export function botTools(spec: AgentSpec): BotTool[] {
  const policy = legacyApprovalPolicy('customer_bot');
  const candidates = [knowledgeSearchTool(spec)];
  return candidates.filter(
    (tool) =>
      spec.allowedActions.includes(tool.action) &&
      isActionId(tool.action) &&
      approvalRequirement(tool.action, policy) === 'none',
  );
}

/** Вызов с проверкой: инструмент есть в разрешённом списке этого агента. */
export function executeTool(tools: BotTool[], name: string, input: unknown): string {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new ToolDeniedError(`tool ${name} is not allowed for this agent`);
  return tool.execute(input);
}

export function toToolDefinitions(tools: BotTool[]): AgentToolDefinition[] {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}
