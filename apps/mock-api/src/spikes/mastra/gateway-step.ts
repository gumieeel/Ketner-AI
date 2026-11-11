/**
 * СПАЙК T4.0 (ветка claude/mastra-spike, в main не идёт, к маршрутам не подключён).
 *
 * Один шаг агента через существующий AIGateway: тот же запрос, что у бота для клиентов
 * (builder/service.ts → answer: assistant с replaceSystemPrompt, потолком ответа и потолком списания),
 * плюс `agentStep` с инструментами. Выбор модели, запасные модели, цену, запись учёта и списание
 * кредитов делает шлюз. Ключей провайдеров здесь нет и быть не может: только вызов шлюза.
 *
 * Этим шагом пользуются оба варианта спайка: модель для Mastra (ketner-language-model.ts) и
 * собственный цикл (own-loop.ts).
 */

import type { AIGateway } from '../../ai/gateway.js';
import type { AgentMessage, AgentToolCall, AgentToolDefinition } from '../../ai/agent/agent-types.js';
import type { GatewayRequest } from '../../ai/gateway-types.js';
import type { PlanId } from '../../types.js';

export interface BotCaller {
  userId: string;
  plan: PlanId;
  email?: string;
  isVip?: boolean;
  language: 'ru' | 'en';
}

/** Что бот передаёт шлюзу помимо диалога — ровно как builder/service.ts → answer(). */
export interface BotAnswerOptions {
  solutionId: string;
  /** Блок настроек бота (builder/bot-prompt.ts → buildBotInstructions). */
  instructions: string;
  conversationId: string;
  maxOutputTokens: number;
  maxChargeUsd: number;
}

export interface GatewayStepResult {
  text: string;
  toolCalls: AgentToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  creditsUsd: number;
  model: { id: string; name: string } | null;
  finishReason: 'stop' | 'length' | 'cancelled' | 'error';
}

export class GatewayStepError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Текстовая копия диалога для проверки размера и анализа запроса в шлюзе. */
function textTranscript(messages: AgentMessage[]): GatewayRequest['messages'] {
  const out: GatewayRequest['messages'] = [];
  for (const message of messages) {
    if (message.role === 'user') out.push({ role: 'user', content: message.content });
    else if (message.role === 'assistant' && message.content) {
      out.push({ role: 'assistant', content: message.content });
    }
  }
  if (out.length === 0 || out[out.length - 1].role !== 'user') {
    // Последняя реплика пользователя нужна шлюзу для анализа запроса.
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser && lastUser.role === 'user') out.push({ role: 'user', content: lastUser.content });
  }
  return out;
}

export async function runGatewayStep(
  gateway: AIGateway,
  caller: BotCaller,
  options: BotAnswerOptions,
  step: { messages: AgentMessage[]; tools: AgentToolDefinition[] },
  onDelta?: (delta: string) => void,
  signal?: AbortSignal,
): Promise<GatewayStepResult> {
  const result: GatewayStepResult = {
    text: '',
    toolCalls: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    costUsd: 0,
    creditsUsd: 0,
    model: null,
    finishReason: 'stop',
  };
  let failure: { code: string; message: string } | null = null;
  await gateway.stream(
    {
      userId: caller.userId,
      userPlan: caller.plan,
      ...(caller.email ? { userEmail: caller.email } : {}),
      isVip: caller.isVip ?? false,
      isAnonymous: false,
      conversationId: options.conversationId,
      modelId: 'auto',
      messages: textTranscript(step.messages),
      language: caller.language,
      stream: true,
      ...(signal ? { signal } : {}),
      assistant: {
        id: options.solutionId,
        instructions: options.instructions,
        maxOutputTokens: options.maxOutputTokens,
        maxChargeUsd: options.maxChargeUsd,
        replaceSystemPrompt: true,
      },
      agentStep: { messages: step.messages, tools: step.tools },
    },
    {
      onDelta: (delta) => {
        result.text += delta;
        onDelta?.(delta);
      },
      onDone: (done) => {
        result.toolCalls = done.toolCalls ?? [];
        result.usage = { inputTokens: done.inputTokens, outputTokens: done.outputTokens };
        result.costUsd = done.costUsd ?? 0;
        result.creditsUsd = done.creditsUsd ?? 0;
        result.model = done.selectedModel ?? null;
        result.finishReason = done.finishReason;
      },
      onError: (error) => {
        failure = error;
      },
    },
    () => signal?.aborted ?? false,
  );
  if (failure) {
    const { code, message } = failure as { code: string; message: string };
    throw new GatewayStepError(code, message);
  }
  return result;
}
