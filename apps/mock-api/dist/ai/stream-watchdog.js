/**
 * Сторож потока ответа модели.
 *
 * Прежний единый таймер на 25 секунд обрывал любой длинный ответ (большой файл, рассуждения),
 * даже когда токены шли непрерывно. Теперь три независимых срока:
 *  - до первого токена (модель не отвечает),
 *  - простой между токенами (поток завис),
 *  - общий потолок (защита от бесконечной генерации).
 */
export const DEFAULT_WATCHDOG_LIMITS = {
    firstTokenMs: 25_000,
    idleMs: 30_000,
    totalMs: 240_000,
};
export function createStreamWatchdog(limits, onTimeout) {
    let reason = null;
    let stopped = false;
    let phaseTimer;
    const fire = (r) => {
        if (stopped || reason)
            return;
        reason = r;
        stopped = true;
        clearTimeout(phaseTimer);
        clearTimeout(totalTimer);
        onTimeout(r);
    };
    const arm = (ms, r) => {
        clearTimeout(phaseTimer);
        phaseTimer = setTimeout(() => fire(r), ms);
    };
    const totalTimer = setTimeout(() => fire('total'), limits.totalMs);
    arm(limits.firstTokenMs, 'first_token');
    return {
        touch() {
            if (stopped)
                return;
            arm(limits.idleMs, 'idle');
        },
        stop() {
            stopped = true;
            clearTimeout(phaseTimer);
            clearTimeout(totalTimer);
        },
        get reason() {
            return reason;
        },
    };
}
