/**
 * Сторож потока ответа модели.
 *
 * Прежний единый таймер на 25 секунд обрывал любой длинный ответ (большой файл, рассуждения),
 * даже когда токены шли непрерывно. Теперь три независимых срока:
 *  - до первого токена (модель не отвечает),
 *  - простой между токенами (поток завис),
 *  - общий потолок (защита от бесконечной генерации).
 */

export interface WatchdogLimits {
  firstTokenMs: number;
  idleMs: number;
  totalMs: number;
}

export const DEFAULT_WATCHDOG_LIMITS: WatchdogLimits = {
  firstTokenMs: 25_000,
  idleMs: 30_000,
  totalMs: 240_000,
};

export type WatchdogReason = 'first_token' | 'idle' | 'total';

export interface StreamWatchdog {
  /** Вызывать на каждом полученном фрагменте ответа. */
  touch(): void;
  stop(): void;
  readonly reason: WatchdogReason | null;
}

export function createStreamWatchdog(
  limits: WatchdogLimits,
  onTimeout: (reason: WatchdogReason) => void,
): StreamWatchdog {
  let reason: WatchdogReason | null = null;
  let stopped = false;
  let phaseTimer: ReturnType<typeof setTimeout> | undefined;

  const fire = (r: WatchdogReason): void => {
    if (stopped || reason) return;
    reason = r;
    stopped = true;
    clearTimeout(phaseTimer);
    clearTimeout(totalTimer);
    onTimeout(r);
  };

  const arm = (ms: number, r: WatchdogReason): void => {
    clearTimeout(phaseTimer);
    phaseTimer = setTimeout(() => fire(r), ms);
  };

  const totalTimer = setTimeout(() => fire('total'), limits.totalMs);
  arm(limits.firstTokenMs, 'first_token');

  return {
    touch(): void {
      if (stopped) return;
      arm(limits.idleMs, 'idle');
    },
    stop(): void {
      stopped = true;
      clearTimeout(phaseTimer);
      clearTimeout(totalTimer);
    },
    get reason(): WatchdogReason | null {
      return reason;
    },
  };
}
