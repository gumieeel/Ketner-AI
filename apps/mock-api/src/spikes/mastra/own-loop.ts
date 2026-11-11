/**
 * СПАЙК T4.0, вариант для сравнения: собственный цикл агента поверх того же шага шлюза
 * (gateway-step.ts) и тех же инструментов (bot-tools.ts). Без Mastra.
 */

import type { AgentMessage } from '../../ai/agent/agent-types.js';
import type { AIGateway } from '../../ai/gateway.js';
import type { AgentSpec } from '../../platform/agent-spec.js';
import { executeTool, toToolDefinitions, ToolDeniedError, type BotTool } from './bot-tools.js';
import { runGatewayStep, type BotAnswerOptions, type BotCaller } from './gateway-step.js';

export interface OwnLoopResult {
  text: string;
  steps: number;
  toolCalls: string[];
  costUsd: number;
  creditsUsd: number;
  stoppedBy: 'answer' | 'max_steps' | 'max_tool_calls';
}

export async function runOwnLoop(
  gateway: AIGateway,
  caller: BotCaller,
  options: BotAnswerOptions,
  spec: AgentSpec,
  tools: BotTool[],
  input: string,
  signal?: AbortSignal,
): Promise<OwnLoopResult> {
  const messages: AgentMessage[] = [{ role: 'user', content: input }];
  const definitions = toToolDefinitions(tools);
  const result: OwnLoopResult = {
    text: '',
    steps: 0,
    toolCalls: [],
    costUsd: 0,
    creditsUsd: 0,
    stoppedBy: 'max_steps',
  };
  for (let step = 0; step < spec.limits.maxSteps; step += 1) {
    const reply = await runGatewayStep(gateway, caller, options, { messages, tools: definitions }, undefined, signal);
    result.steps += 1;
    result.costUsd += reply.costUsd;
    result.creditsUsd += reply.creditsUsd;
    if (reply.toolCalls.length === 0) {
      result.text = reply.text;
      result.stoppedBy = 'answer';
      return result;
    }
    messages.push({ role: 'assistant', content: reply.text || null, tool_calls: reply.toolCalls });
    for (const call of reply.toolCalls) {
      if (result.toolCalls.length >= spec.limits.maxToolCalls) {
        result.stoppedBy = 'max_tool_calls';
        return result;
      }
      result.toolCalls.push(call.function.name);
      let content: string;
      try {
        content = executeTool(tools, call.function.name, JSON.parse(call.function.arguments || '{}'));
      } catch (error) {
        content = error instanceof ToolDeniedError ? `denied: ${error.message}` : 'tool error';
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content });
    }
  }
  return result;
}
