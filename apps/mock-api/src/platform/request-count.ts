/**
 * Что считается обращением к тарифу (docs/SUBSCRIPTION_PRICING_DESIGN.md, раздел 5.1). Одно правило —
 * в двух видах: функция для журнала в памяти и условие SQL для Postgres; тест сверяет их.
 *
 * Засчитывается исполнение, у которого:
 * 1. посетитель или событие, а не проба владельца (`manual`) — `trigger_kind` из COUNTED_TRIGGERS;
 * 2. `status = 'succeeded'` — посетитель получил ответ модели или передачу сотруднику (`answer`,
 *    `escalated`, финальный ответ после лимита `max_steps` / `max_tool_calls` / `budget`);
 * 3. `stop_reason <> 'failures'` — отказали наши инструменты: не считается, даже с финальным ответом;
 * 4. `output_meta.steps >= 1` — модель вызывалась.
 */

export const COUNTED_TRIGGERS = ['public_page', 'channel_event', 'webhook', 'schedule'] as const;

export interface CountableExecution {
  triggerKind: string;
  status: string;
  stopReason: string | null;
  outputMeta: Record<string, unknown>;
}

export function isCountedRequest(execution: CountableExecution): boolean {
  const steps = execution.outputMeta.steps;
  return (
    (COUNTED_TRIGGERS as readonly string[]).includes(execution.triggerKind) &&
    execution.status === 'succeeded' &&
    execution.stopReason !== 'failures' &&
    typeof steps === 'number' &&
    steps >= 1
  );
}

/** То же правило условием SQL над таблицей `executions` (алиас не нужен). */
export const COUNTED_REQUEST_SQL = `trigger_kind IN (${COUNTED_TRIGGERS.map((kind) => `'${kind}'`).join(', ')})
  AND status = 'succeeded'
  AND stop_reason IS DISTINCT FROM 'failures'
  AND jsonb_typeof(output_meta -> 'steps') = 'number'
  AND (output_meta ->> 'steps')::numeric >= 1`;

/** Засчитанные обращения за период: по аккаунту. */
export interface RequestCount {
  userId: string;
  count: number;
}
