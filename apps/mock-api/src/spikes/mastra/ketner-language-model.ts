/**
 * СПАЙК T4.0: модель для Mastra (спецификация AI SDK LanguageModelV2), которая внутри вызывает
 * существующий AIGateway (gateway-step.ts). Mastra видит только этот объект: ни ключей провайдеров,
 * ни адресов, ни выбора модели. Модель выбирает шлюз (Auto), он же считает цену, пишет учёт и
 * списывает кредиты с владельца бота; запасные модели — тоже его.
 *
 * Системные сообщения из подсказки Mastra не передаются: системный промпт бота строит шлюз
 * (assistant.replaceSystemPrompt), как у прежнего пути. Инструкции агента Mastra поэтому пустые.
 */

import type { AgentMessage, AgentToolCall, AgentToolDefinition } from '../../ai/agent/agent-types.js';
import type { AIGateway } from '../../ai/gateway.js';
import { runGatewayStep, type BotAnswerOptions, type BotCaller } from './gateway-step.js';

// Типы спецификации LanguageModelV2 (@ai-sdk/provider 2.0.5). В спайке берутся из пакета-псевдонима
// @ai-sdk/provider-v5, который ставит сам Mastra; при переносе — явная зависимость @ai-sdk/provider.
import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2FunctionTool,
  LanguageModelV2Prompt,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
} from '@ai-sdk/provider-v5';

type V2Message = LanguageModelV2Prompt[number];
type V2CallOptions = LanguageModelV2CallOptions;

/** Перевод подсказки Mastra в сообщения шага агента (формат OpenAI, как у AgentGateway). */
export function toAgentMessages(prompt: V2Message[]): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const message of prompt) {
    if (message.role === 'system') continue; // системный промпт — у шлюза
    if (message.role === 'user') {
      const text = message.content
        .flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join('\n');
      out.push({ role: 'user', content: text });
      continue;
    }
    if (message.role === 'assistant') {
      const text = message.content
        .flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join('');
      const calls: AgentToolCall[] = message.content
        .flatMap((part) => (part.type === 'tool-call' ? [part] : []))
        .map((part) => ({
          id: part.toolCallId,
          type: 'function',
          function: {
            name: part.toolName,
            arguments: typeof part.input === 'string' ? part.input : JSON.stringify(part.input ?? {}),
          },
        }));
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    for (const part of message.content) {
      if (part.type !== 'tool-result') continue;
      const output = part.output;
      const content =
        output.type === 'text' || output.type === 'error-text'
          ? output.value
          : JSON.stringify(output.value);
      out.push({ role: 'tool', tool_call_id: part.toolCallId, content });
    }
  }
  return out;
}

function toAgentTools(tools: V2CallOptions['tools']): AgentToolDefinition[] {
  return (tools ?? [])
    .filter((tool): tool is LanguageModelV2FunctionTool => tool.type === 'function')
    .map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parameters: tool.inputSchema as Record<string, unknown>,
      },
    }));
}

export interface KetnerModelCall {
  costUsd: number;
  creditsUsd: number;
  model: { id: string; name: string } | null;
}

export class KetnerLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2' as const;
  readonly provider = 'ketner-gateway';
  readonly modelId = 'auto';
  readonly supportedUrls: Record<string, RegExp[]> = {};
  /** Что вернул шлюз на каждом шаге (для проверки в тестах и отчёте). */
  readonly calls: KetnerModelCall[] = [];

  constructor(
    private readonly gateway: AIGateway,
    private readonly caller: BotCaller,
    private readonly options: BotAnswerOptions,
  ) {}

  private async step(options: V2CallOptions, onDelta?: (delta: string) => void) {
    const result = await runGatewayStep(
      this.gateway,
      this.caller,
      this.options,
      { messages: toAgentMessages(options.prompt), tools: toAgentTools(options.tools) },
      onDelta,
      options.abortSignal,
    );
    this.calls.push({ costUsd: result.costUsd, creditsUsd: result.creditsUsd, model: result.model });
    const usage: LanguageModelV2Usage = {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.inputTokens + result.usage.outputTokens,
    };
    const finishReason: LanguageModelV2FinishReason =
      result.toolCalls.length > 0
        ? 'tool-calls'
        : result.finishReason === 'length'
          ? 'length'
          : result.finishReason === 'error'
            ? 'error'
            : result.finishReason === 'cancelled'
              ? 'other'
              : 'stop';
    const toolCalls = result.toolCalls.map((call) => ({
      type: 'tool-call' as const,
      toolCallId: call.id,
      toolName: call.function.name,
      input: call.function.arguments || '{}',
    }));
    const providerMetadata = {
      ketner: {
        costUsd: result.costUsd,
        creditsUsd: result.creditsUsd,
        modelId: result.model?.id ?? null,
      },
    };
    return { text: result.text, toolCalls, usage, finishReason, providerMetadata };
  }

  async doGenerate(options: V2CallOptions) {
    const step = await this.step(options);
    const content: LanguageModelV2Content[] = [
      ...(step.text ? [{ type: 'text' as const, text: step.text }] : []),
      ...step.toolCalls,
    ];
    return {
      content,
      finishReason: step.finishReason,
      usage: step.usage,
      providerMetadata: step.providerMetadata,
      warnings: [],
    };
  }

  async doStream(options: V2CallOptions) {
    // Шлюз стримит текст по мере генерации; части потока Mastra отдаются сразу.
    let controllerRef: ReadableStreamDefaultController<LanguageModelV2StreamPart> | null = null;
    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      start: (controller) => {
        controllerRef = controller;
      },
    });
    const controller = controllerRef as unknown as ReadableStreamDefaultController<LanguageModelV2StreamPart>;
    controller.enqueue({ type: 'stream-start', warnings: [] });
    let textStarted = false;
    void this.step(options, (delta) => {
      if (!textStarted) {
        controller.enqueue({ type: 'text-start', id: 'text-0' });
        textStarted = true;
      }
      controller.enqueue({ type: 'text-delta', id: 'text-0', delta });
    }).then(
      (step) => {
        if (textStarted) controller.enqueue({ type: 'text-end', id: 'text-0' });
        for (const call of step.toolCalls) controller.enqueue(call);
        controller.enqueue({
          type: 'finish',
          finishReason: step.finishReason,
          usage: step.usage,
          providerMetadata: step.providerMetadata,
        });
        controller.close();
      },
      (error: unknown) => {
        controller.enqueue({ type: 'error', error });
        controller.close();
      },
    );
    return { stream };
  }
}
