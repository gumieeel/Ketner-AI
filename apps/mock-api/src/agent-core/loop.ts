/**
 * Ядро цикла агента (docs/AGENT_LOOP_CONVERGENCE.md, раздел 2): шаг модели → вызовы инструментов →
 * проверка прав → выполнение → следующий шаг, до ответа или лимита.
 *
 * Что делает ядро:
 * - передаёт в каждый шаг остаток потолка списания (`maxChargeUsd`): сумма списаний за прогон не
 *   превышает `limits.budgetUsd`; шаг не начинается, если остаток меньше `minStepBudgetUsd`;
 * - проверяет право на действие перед каждым вызовом инструмента (`authorize`);
 * - ошибку или таймаут инструмента отдаёт модели как результат, а не роняет прогон; после
 *   `maxConsecutiveFailures` сбоев подряд — остановка `failures`;
 * - останавливается с закрытым списком причин (`StopReason`);
 * - с `finalAnswer` вместо остановки по лимиту делает последний шаг без инструментов (бюджет на него
 *   зарезервирован), чтобы собеседник получил ответ;
 * - модели отдаёт только безопасные сообщения об ошибках инструментов (`TOOL_ERROR_MESSAGES`), полная
 *   ошибка — в событиях прогона.
 * Чего не делает: не выбирает модель, не считает цену и не пишет учёт — это шаг модели (AIGateway).
 */

import type { AgentMessage, AgentToolCall } from '../ai/agent/agent-types.js';
import {
  StepError,
  TOOL_ERROR_MESSAGES,
  type LoopEvent,
  type LoopResult,
  type LoopRun,
  type LoopTool,
  type StepResult,
  type StopReason,
  type ToolErrorCode,
} from './types.js';

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/** Остановки, после которых при `finalAnswer` делается последний шаг без инструментов. */
type LimitStop = 'max_steps' | 'max_tool_calls' | 'budget' | 'failures';

export async function runAgentLoop(run: LoopRun): Promise<LoopResult> {
  const { limits } = run;
  const finalAnswer = run.finalAnswer === true;
  const messages: AgentMessage[] = [...run.messages];
  const definitions = run.tools.map((tool) => ({
    type: 'function' as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
  const result: LoopResult = {
    stopReason: 'answer',
    text: '',
    finalStep: false,
    steps: 0,
    toolCalls: [],
    costUsd: 0,
    creditsUsd: 0,
    model: null,
    escalation: null,
    error: null,
  };

  const emit = async (event: LoopEvent): Promise<void> => {
    if (!run.onEvent) return;
    try {
      await run.onEvent(event);
    } catch (error) {
      run.onHookError?.(error, event);
    }
  };
  const stop = async (reason: StopReason): Promise<LoopResult> => {
    result.stopReason = reason;
    await emit({ type: 'stopped', reason });
    return result;
  };

  // Общий срок прогона и внешняя отмена — один сигнал для шагов и инструментов.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('agent run timeout'));
  }, limits.timeoutMs);
  const onExternalAbort = (): void => controller.abort(new Error('cancelled'));
  if (run.signal?.aborted) controller.abort(new Error('cancelled'));
  else run.signal?.addEventListener('abort', onExternalAbort, { once: true });
  const interrupted = (): StopReason | null =>
    controller.signal.aborted ? (timedOut ? 'timeout' : 'cancelled') : null;

  /** Самый дорогой шаг прогона (полная цена): оценка последнего шага без инструментов. */
  let mostExpensiveStepUsd = 0;

  /** Шаг модели; ошибка шага — остановка (`error`, либо `timeout`/`cancelled`, если прервано). */
  const callStep = async (
    step: number,
    maxChargeUsd: number,
    final: boolean,
  ): Promise<StepResult | { failed: StopReason }> => {
    await emit({ type: 'step_started', step, maxChargeUsd, final });
    let reply: StepResult;
    try {
      reply = await run.step({
        step,
        messages: run.prepareMessages ? run.prepareMessages(messages, step) : messages,
        tools: definitions,
        maxChargeUsd,
        signal: controller.signal,
        ...(final ? { toolChoice: 'none' as const } : {}),
      });
    } catch (error) {
      const code = error instanceof StepError ? error.code : 'step_failed';
      const message = error instanceof Error ? error.message : String(error);
      await emit({ type: 'step_failed', step, code });
      const halted = interrupted();
      if (halted) return { failed: halted };
      result.error = { code, message };
      return { failed: 'error' };
    }
    result.steps = step;
    result.costUsd = round6(result.costUsd + reply.costUsd);
    result.creditsUsd = round6(result.creditsUsd + reply.creditsUsd);
    result.text = reply.text;
    if (reply.model) result.model = reply.model;
    mostExpensiveStepUsd = Math.max(mostExpensiveStepUsd, reply.costUsd);
    await emit({
      type: 'step_finished',
      step,
      costUsd: reply.costUsd,
      creditsUsd: reply.creditsUsd,
      toolCalls: final ? 0 : reply.toolCalls.length,
      model: reply.model?.id ?? null,
    });
    return reply;
  };

  /**
   * Последний шаг без инструментов после лимита. Без бюджета на него (остаток меньше минимального
   * шага) или при его ошибке — остановка по лимиту без текста.
   */
  const finish = async (reason: LimitStop, step: number): Promise<LoopResult> => {
    const halted = interrupted();
    if (halted) return stop(halted);
    const remaining = round6(limits.budgetUsd - result.creditsUsd);
    if (!finalAnswer || step > limits.maxSteps || remaining < limits.minStepBudgetUsd) {
      result.text = '';
      return stop(reason);
    }
    answerOpenCalls(messages);
    const reply = await callStep(step, remaining, true);
    if ('failed' in reply) {
      result.text = '';
      return stop(reply.failed === 'error' ? reason : reply.failed);
    }
    result.finalStep = true;
    return stop(reason);
  };

  let consecutiveFailures = 0;
  try {
    for (let step = 1; ; step += 1) {
      const halted = interrupted();
      if (halted) return await stop(halted);
      if (step > limits.maxSteps) return await stop('max_steps');
      // С `finalAnswer` последний разрешённый шаг — без инструментов (после хотя бы одного шага с ними).
      if (finalAnswer && step > 1 && step === limits.maxSteps)
        return await finish('max_steps', step);
      const remaining = round6(limits.budgetUsd - result.creditsUsd);
      const reserve =
        finalAnswer && step > 1 ? Math.max(limits.minStepBudgetUsd, mostExpensiveStepUsd) : 0;
      const stepCap = round6(remaining - reserve);
      if (stepCap < limits.minStepBudgetUsd) {
        return await (step > 1 ? finish('budget', step) : stop('budget'));
      }

      const reply = await callStep(step, stepCap, false);
      if ('failed' in reply) return await stop(reply.failed);
      if (reply.toolCalls.length === 0) return await stop('answer');

      messages.push({
        role: 'assistant',
        content: reply.text || null,
        tool_calls: reply.toolCalls,
      });
      let limitHit: LimitStop | null = null;
      for (const [index, call] of reply.toolCalls.entries()) {
        if (index >= limits.maxToolCallsPerStep) {
          await reject(call, step, 'too_many_calls_in_step', `call #${index + 1} in one step`);
          continue;
        }
        if (result.toolCalls.length >= limits.maxToolCalls) {
          limitHit = 'max_tool_calls';
          break;
        }
        const outcome = await callTool(run, call, step, controller.signal, emit);
        result.toolCalls.push({ tool: call.function.name, ok: outcome.ok });
        messages.push(toolMessage(call, outcome.content));
        if (outcome.escalate) {
          result.escalation = { tool: call.function.name, reason: outcome.escalate.reason };
          return await stop('escalated');
        }
        consecutiveFailures = outcome.ok ? 0 : consecutiveFailures + 1;
        if (consecutiveFailures >= limits.maxConsecutiveFailures) {
          limitHit = 'failures';
          break;
        }
      }
      if (limitHit) return await finish(limitHit, step + 1);
    }
  } finally {
    clearTimeout(timer);
    run.signal?.removeEventListener('abort', onExternalAbort);
  }

  async function reject(
    call: AgentToolCall,
    step: number,
    code: ToolErrorCode,
    detail: string,
  ): Promise<void> {
    messages.push(toolMessage(call, TOOL_ERROR_MESSAGES[code]));
    await emit({
      type: 'tool_rejected',
      step,
      tool: call.function.name.slice(0, 64),
      callId: call.id,
      code,
      detail,
    });
  }
}

function toolMessage(call: AgentToolCall, content: string): AgentMessage {
  return { role: 'tool', tool_call_id: call.id, content };
}

/**
 * У каждого вызова последнего шага должен быть результат, иначе провайдер отклонит следующий шаг.
 * Невыполненные из-за лимита вызовы получают `not_executed`.
 */
function answerOpenCalls(messages: AgentMessage[]): void {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!lastAssistant || lastAssistant.role !== 'assistant' || !lastAssistant.tool_calls) return;
  const answered = new Set(messages.flatMap((m) => (m.role === 'tool' ? [m.tool_call_id] : [])));
  for (const call of lastAssistant.tool_calls) {
    if (!answered.has(call.id)) messages.push(toolMessage(call, TOOL_ERROR_MESSAGES.not_executed));
  }
}

const errorText = (error: unknown): string =>
  (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 500);

/** Проверка, права, выполнение одного вызова. Ошибки не бросаются: они — результат для модели. */
async function callTool(
  run: LoopRun,
  call: AgentToolCall,
  step: number,
  signal: AbortSignal,
  emit: (event: LoopEvent) => Promise<void>,
): Promise<{ ok: boolean; content: string; escalate?: { reason: string } }> {
  const name = call.function.name;
  const rejected = async (code: ToolErrorCode, detail: string) => {
    await emit({
      type: 'tool_rejected',
      step,
      tool: name.slice(0, 64),
      callId: call.id,
      code,
      detail: detail.slice(0, 500),
    });
    return { ok: false, content: TOOL_ERROR_MESSAGES[code] };
  };
  const tool: LoopTool | undefined = run.tools.find((candidate) => candidate.name === name);
  if (!tool) return rejected('unknown_tool', `no tool named ${name.slice(0, 64)}`);

  const decision = run.authorize(tool.action);
  if (!decision.allowed) {
    await emit({
      type: 'tool_denied',
      step,
      tool: name,
      action: tool.action,
      reason: decision.reason,
    });
    return { ok: false, content: TOOL_ERROR_MESSAGES.not_allowed };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(call.function.arguments || '{}');
  } catch (error) {
    return rejected('invalid_json', errorText(error));
  }
  const parsed = tool.parse(raw);
  if (!parsed.ok) return rejected('invalid_arguments', parsed.error);

  await emit({
    type: 'tool_started',
    step,
    tool: name,
    action: tool.action,
    callId: call.id,
    authorizedBy: decision.authorizedBy,
  });
  // Срок вызова: свой сигнал инструмента — прерывается и общим сроком прогона, и сроком вызова.
  const toolController = new AbortController();
  const onRunAbort = (): void => toolController.abort(signal.reason);
  if (signal.aborted) toolController.abort(signal.reason);
  else signal.addEventListener('abort', onRunAbort, { once: true });
  let toolTimer: ReturnType<typeof setTimeout> | undefined;
  let toolTimedOut = false;
  const timeoutMs = run.limits.toolTimeoutMs;
  try {
    const execution = tool.execute(parsed.value, { step, signal: toolController.signal });
    const outcome = timeoutMs
      ? await Promise.race([
          execution,
          new Promise<never>((_, reject) => {
            toolTimer = setTimeout(() => {
              const error = new Error(`tool ${name} timed out after ${timeoutMs} ms`);
              toolTimedOut = true;
              reject(error);
              toolController.abort(error);
            }, timeoutMs);
          }),
        ])
      : await execution;
    await emit({
      type: 'tool_finished',
      step,
      tool: name,
      action: tool.action,
      callId: call.id,
      ok: true,
      escalate: Boolean(outcome.escalate),
      ...(outcome.meta ? { meta: outcome.meta } : {}),
    });
    return {
      ok: true,
      content: outcome.content,
      ...(outcome.escalate ? { escalate: outcome.escalate } : {}),
    };
  } catch (error) {
    // Отмена по сроку прогона — тоже срок: инструмент не ответил вовремя.
    const code: ToolErrorCode = toolTimedOut || signal.aborted ? 'tool_timeout' : 'tool_failed';
    await emit({
      type: 'tool_finished',
      step,
      tool: name,
      action: tool.action,
      callId: call.id,
      ok: false,
      escalate: false,
      error: { code, message: errorText(error) },
    });
    return { ok: false, content: TOOL_ERROR_MESSAGES[code] };
  } finally {
    if (toolTimer) clearTimeout(toolTimer);
    signal.removeEventListener('abort', onRunAbort);
  }
}
