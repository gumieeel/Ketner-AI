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
 * - останавливается с закрытым списком причин (`StopReason`).
 * Чего не делает: не выбирает модель, не считает цену и не пишет учёт — это шаг модели (AIGateway).
 */

import type { AgentMessage, AgentToolCall } from '../ai/agent/agent-types.js';
import {
  StepError,
  type LoopEvent,
  type LoopResult,
  type LoopRun,
  type LoopTool,
  type StopReason,
} from './types.js';

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

export async function runAgentLoop(run: LoopRun): Promise<LoopResult> {
  const { limits } = run;
  const messages: AgentMessage[] = [...run.messages];
  const definitions = run.tools.map((tool) => ({
    type: 'function' as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
  const result: LoopResult = {
    stopReason: 'answer',
    text: '',
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

  let consecutiveFailures = 0;
  try {
    for (let step = 1; ; step += 1) {
      const halted = interrupted();
      if (halted) return await stop(halted);
      if (step > limits.maxSteps) return await stop('max_steps');
      const remaining = round6(limits.budgetUsd - result.creditsUsd);
      if (remaining < limits.minStepBudgetUsd) return await stop('budget');

      await emit({ type: 'step_started', step, maxChargeUsd: remaining });
      let reply;
      try {
        reply = await run.step({
          step,
          messages: run.prepareMessages ? run.prepareMessages(messages, step) : messages,
          tools: definitions,
          maxChargeUsd: remaining,
          signal: controller.signal,
        });
      } catch (error) {
        const code = error instanceof StepError ? error.code : 'step_failed';
        const message = error instanceof Error ? error.message : String(error);
        await emit({ type: 'step_failed', step, code });
        const haltedByStep = interrupted();
        if (haltedByStep) return await stop(haltedByStep);
        result.error = { code, message };
        return await stop('error');
      }

      result.steps = step;
      result.costUsd = round6(result.costUsd + reply.costUsd);
      result.creditsUsd = round6(result.creditsUsd + reply.creditsUsd);
      result.text = reply.text;
      if (reply.model) result.model = reply.model;
      await emit({
        type: 'step_finished',
        step,
        costUsd: reply.costUsd,
        creditsUsd: reply.creditsUsd,
        toolCalls: reply.toolCalls.length,
        model: reply.model?.id ?? null,
      });

      if (reply.toolCalls.length === 0) return await stop('answer');

      messages.push({
        role: 'assistant',
        content: reply.text || null,
        tool_calls: reply.toolCalls,
      });
      for (const [index, call] of reply.toolCalls.entries()) {
        if (index >= limits.maxToolCallsPerStep) {
          messages.push(
            toolMessage(
              call,
              `Error: too many tool calls in one step (limit ${limits.maxToolCallsPerStep}).`,
            ),
          );
          continue;
        }
        if (result.toolCalls.length >= limits.maxToolCalls) return await stop('max_tool_calls');
        const outcome = await callTool(run, call, step, controller.signal, emit);
        result.toolCalls.push({ tool: call.function.name, ok: outcome.ok });
        messages.push(toolMessage(call, outcome.content));
        if (outcome.escalate) {
          result.escalation = { tool: call.function.name, reason: outcome.escalate.reason };
          return await stop('escalated');
        }
        consecutiveFailures = outcome.ok ? 0 : consecutiveFailures + 1;
        if (consecutiveFailures >= limits.maxConsecutiveFailures) return await stop('failures');
      }
    }
  } finally {
    clearTimeout(timer);
    run.signal?.removeEventListener('abort', onExternalAbort);
  }
}

function toolMessage(call: AgentToolCall, content: string): AgentMessage {
  return { role: 'tool', tool_call_id: call.id, content };
}

/** Проверка, права, выполнение одного вызова. Ошибки не бросаются: они — результат для модели. */
async function callTool(
  run: LoopRun,
  call: AgentToolCall,
  step: number,
  signal: AbortSignal,
  emit: (event: LoopEvent) => Promise<void>,
): Promise<{ ok: boolean; content: string; escalate?: { reason: string } }> {
  const name = call.function.name;
  const tool: LoopTool | undefined = run.tools.find((candidate) => candidate.name === name);
  if (!tool) return { ok: false, content: `Error: unknown tool ${name}.` };

  const decision = run.authorize(tool.action);
  if (!decision.allowed) {
    await emit({
      type: 'tool_denied',
      step,
      tool: name,
      action: tool.action,
      reason: decision.reason,
    });
    return { ok: false, content: `Error: action ${tool.action} is not allowed for this agent.` };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(call.function.arguments || '{}');
  } catch {
    return { ok: false, content: 'Error: tool arguments are not valid JSON.' };
  }
  const parsed = tool.parse(raw);
  if (!parsed.ok) return { ok: false, content: `Error: invalid arguments: ${parsed.error}` };

  await emit({
    type: 'tool_started',
    step,
    tool: name,
    action: tool.action,
    callId: call.id,
    authorizedBy: decision.authorizedBy,
  });
  try {
    const outcome = await tool.execute(parsed.value, { step, signal });
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
    await emit({
      type: 'tool_finished',
      step,
      tool: name,
      action: tool.action,
      callId: call.id,
      ok: false,
      escalate: false,
    });
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, content: `Error: tool ${name} failed: ${message.slice(0, 200)}` };
  }
}
