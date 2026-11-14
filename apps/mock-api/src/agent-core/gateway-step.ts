/**
 * Шаг модели ядра цикла поверх AIGateway (`GatewayRequest.agentStep`, T4.1): выбор модели, запасные
 * модели, сторож, цена, запись учёта и списание кредитов — у шлюза. Шаг получает остаток потолка
 * прогона и передаёт его шлюзу как потолок списания этого вызова.
 */

import type { AgentMessage } from '../ai/agent/agent-types.js';
import type { AIGateway } from '../ai/gateway.js';
import type { GatewayRequest } from '../ai/gateway-types.js';
import { StepError, type ModelStep, type StepResult } from './types.js';

/** Запрос шлюза без диалога и шага агента: кто платит, язык, настройки помощника или задачи. */
export type GatewayStepBase = Omit<GatewayRequest, 'messages' | 'agentStep' | 'signal'>;

/**
 * Текстовая копия диалога: шлюз по ней проверяет размер и анализирует последний вопрос
 * пользователя. Провайдер получает полный диалог шага (`agentStep.messages`).
 */
export function textTranscript(messages: AgentMessage[]): GatewayRequest['messages'] {
  const out: GatewayRequest['messages'] = [];
  for (const message of messages) {
    if (message.role === 'user') out.push({ role: 'user', content: message.content });
    else if (message.role === 'assistant' && message.content) {
      out.push({ role: 'assistant', content: message.content });
    }
  }
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (lastUser && lastUser.role === 'user' && out.at(-1)?.role !== 'user') {
    out.push({ role: 'user', content: lastUser.content });
  }
  return out;
}

/** Потолок списания шага: у помощника — `assistant.maxChargeUsd`, у служебной задачи — `task`. */
function withCharge(base: GatewayStepBase, maxChargeUsd: number): GatewayStepBase {
  if (base.assistant) return { ...base, assistant: { ...base.assistant, maxChargeUsd } };
  if (base.task) return { ...base, task: { ...base.task, maxChargeUsd } };
  return base;
}

export function createGatewayStep(
  gateway: Pick<AIGateway, 'stream'>,
  base: GatewayStepBase,
  onDelta?: (delta: string, step: number) => void,
): ModelStep {
  return async (input) => {
    const result: StepResult = {
      text: '',
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      costUsd: 0,
      creditsUsd: 0,
      model: null,
    };
    let failure: { code: string; message: string } | null = null;
    await gateway.stream(
      {
        ...withCharge(base, input.maxChargeUsd),
        messages: textTranscript(input.messages),
        agentStep: {
          messages: input.messages,
          tools: input.tools,
          ...(input.toolChoice ? { toolChoice: input.toolChoice } : {}),
        },
        signal: input.signal,
      },
      {
        onDelta: (delta) => {
          result.text += delta;
          onDelta?.(delta, input.step);
        },
        onDone: (done) => {
          result.toolCalls = done.toolCalls ?? [];
          result.usage = { inputTokens: done.inputTokens, outputTokens: done.outputTokens };
          result.costUsd = done.costUsd ?? 0;
          result.creditsUsd = done.creditsUsd ?? 0;
          result.model = done.selectedModel ?? null;
        },
        onError: (error) => {
          failure = error;
        },
      },
      () => input.signal.aborted,
    );
    if (failure) {
      const { code, message } = failure as { code: string; message: string };
      throw new StepError(code, message);
    }
    return result;
  };
}
