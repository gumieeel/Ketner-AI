/**
 * СПАЙК T4.0: бот для клиентов (AgentSpec) как агент Mastra. Модель — мост в AIGateway
 * (ketner-language-model.ts), инструменты — общие (bot-tools.ts) с проверкой прав перед вызовом.
 * К маршрутам не подключено.
 */

import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { AgentSpec } from '../../platform/agent-spec.js';
import { executeTool, type BotTool } from './bot-tools.js';
import type { KetnerLanguageModel } from './ketner-language-model.js';

/**
 * `maxRetries: 0` обязателен: Mastra по умолчанию повторяет вызов модели дважды при любой ошибке, кроме
 * APICallError AI SDK. Повторы и запасные модели — дело шлюза; повтор Mastra прогнал бы цепочку шлюза
 * ещё раз (и мог бы списать кредиты повторно, если шаг уже ответил, а ошибка случилась позже).
 */
export function createMastraBotAgent(
  spec: AgentSpec,
  model: KetnerLanguageModel,
  tools: BotTool[],
  maxRetries = 0,
) {
  const mastraTools = Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      createTool({
        id: tool.name,
        description: tool.description,
        inputSchema: z.object({ query: z.string() }),
        // Права проверяет executeTool: инструмент должен быть в разрешённом списке агента.
        execute: async (input) => executeTool(tools, tool.name, input),
      }),
    ]),
  );
  return new Agent({
    id: 'customer-bot',
    name: spec.name,
    // Системный промпт бота строит шлюз (assistant.replaceSystemPrompt); мост его не передаёт дальше.
    instructions: 'System prompt is provided by the Ketner gateway.',
    model,
    tools: mastraTools,
    maxRetries,
  });
}

export async function runMastraBot(
  spec: AgentSpec,
  model: KetnerLanguageModel,
  tools: BotTool[],
  input: string,
  maxRetries = 0,
): Promise<{ text: string; steps: number; toolCalls: string[] }> {
  const agent = createMastraBotAgent(spec, model, tools, maxRetries);
  const output = await agent.generate(input, { maxSteps: spec.limits.maxSteps });
  const toolCalls = (output.toolCalls ?? []).map((call) => {
    const payload = (call as { payload?: { toolName?: string }; toolName?: string }).payload;
    return payload?.toolName ?? (call as { toolName?: string }).toolName ?? '?';
  });
  return { text: output.text, steps: output.steps?.length ?? 0, toolCalls };
}
