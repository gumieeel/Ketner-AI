/**
 * Reaper зависших исполнений агента. Исполнение остаётся в статусе `running`, если итог не записался:
 * пакет журнала после ответа упал (база недоступна) или процесс остановился до записи.
 *
 * Границы:
 * - порог возраста не меньше `REAPER_MIN_AGE_MS` и не меньше пяти сроков прогона: живой прогон
 *   прерывается ядром по сроку (`LoopLimits.timeoutMs`, у бота 60 с) задолго до порога, поэтому
 *   reaper не может закрыть идущий прогон;
 * - не больше `limit` исполнений за проход, проходы не накладываются;
 * - статус `failed`, причина `error`, ошибка `{ code: 'reaped_stale_running' }`; внутренние эффекты
 *   в `reserved` — `failed`; внешние в `dispatched` не трогаются (исход неизвестен, их сверяют);
 * - позднее закрытие самим прогоном закрытое reaper'ом исполнение не переписывает
 *   (`finish`/`record` меняют только `running`).
 */

import type { ExecutionJournal, ReapedExecution } from './journal.js';

/** Минимальный порог возраста: 10 минут. */
export const REAPER_MIN_AGE_MS = 10 * 60_000;

export interface ReaperOptions {
  /** Самый длинный срок прогона среди агентов на этом журнале, мс. */
  maxRunMs: number;
  /** Возраст исполнения, после которого оно считается зависшим; по умолчанию 15 минут. */
  olderThanMs?: number;
  /** Исполнений за проход; по умолчанию 50. */
  limit?: number;
  /** Пауза между проходами; по умолчанию 5 минут. */
  intervalMs?: number;
  log?: (message: string, details: Record<string, unknown>) => void;
}

export function reaperThreshold(options: Pick<ReaperOptions, 'maxRunMs' | 'olderThanMs'>): number {
  const requested = options.olderThanMs ?? 15 * 60_000;
  const minimum = Math.max(REAPER_MIN_AGE_MS, options.maxRunMs * 5);
  if (requested < minimum) {
    throw new Error(
      `reaper threshold ${requested} ms is below the minimum ${minimum} ms (5 × run timeout, at least 10 min)`,
    );
  }
  return requested;
}

/** Один проход: закрывает не больше `limit` зависших исполнений. */
export async function reapOnce(
  journal: ExecutionJournal,
  options: ReaperOptions,
): Promise<ReapedExecution[]> {
  const olderThanMs = reaperThreshold(options);
  const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
  const reaped = await journal.reapStale({ olderThanMs, limit });
  if (reaped.length > 0) {
    (options.log ?? ((m, d) => console.warn(`[reaper] ${m}`, d)))('closed stale executions', {
      count: reaped.length,
      ids: reaped.map((execution) => execution.id),
    });
  }
  return reaped;
}

/** Периодический reaper; таймер не держит процесс. Возвращает остановку. */
export function startExecutionReaper(
  journal: ExecutionJournal,
  options: ReaperOptions,
): { stop: () => void; runOnce: () => Promise<ReapedExecution[]> } {
  reaperThreshold(options);
  const log = options.log ?? ((m, d) => console.warn(`[reaper] ${m}`, d));
  let running: Promise<ReapedExecution[]> | null = null;
  const runOnce = () => {
    // Проходы не накладываются: следующий ждёт текущий.
    running ??= reapOnce(journal, options)
      .catch((error: unknown) => {
        log('reaper pass failed', { error: String(error) });
        return [];
      })
      .finally(() => {
        running = null;
      });
    return running;
  };
  const timer = setInterval(() => void runOnce(), options.intervalMs ?? 5 * 60_000);
  timer.unref();
  return { stop: () => clearInterval(timer), runOnce };
}
