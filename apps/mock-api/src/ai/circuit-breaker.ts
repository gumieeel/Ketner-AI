/**
 * Circuit Breaker для AI провайдеров (Phase 5).
 *
 * Если провайдер падает N раз подряд (по умолчанию 3), переводит его в состояние 'open'
 * на период cooldown (по умолчанию 30 секунд). При следующем запросе шлюз не тратит время
 * на ожидание таймаута упавшего провайдера, а мгновенно переключается на fallback модель.
 */

export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold?: number; // По умолчанию 3
  cooldownMs?: number;        // По умолчанию 30_000 (30 сек)
}

export interface ProviderCircuitStatus {
  provider: string;
  state: CircuitBreakerState;
  consecutiveFailures: number;
  lastFailureTime: number | null;
  cooldownRemainingMs: number;
}

export class CircuitBreaker {
  private failureThreshold: number;
  private cooldownMs: number;
  private failures = new Map<string, number>();
  private states = new Map<string, CircuitBreakerState>();
  private lastFailureTimes = new Map<string, number>();

  constructor(options?: CircuitBreakerOptions) {
    this.failureThreshold = options?.failureThreshold ?? 3;
    this.cooldownMs = options?.cooldownMs ?? 30_000;
  }

  /**
   * Проверить, открыт ли предохранитель (провайдер временно отключен).
   * Если кулдаун истёк, автоматически переходит в 'half-open' (разрешает 1 пробный запрос).
   */
  isOpen(provider: string): boolean {
    const state = this.states.get(provider) ?? 'closed';
    if (state === 'closed') {
      return false;
    }

    const lastTime = this.lastFailureTimes.get(provider) ?? 0;
    const now = Date.now();
    if (now - lastTime >= this.cooldownMs) {
      // Кулдаун истёк -> переходим в half-open для проверки
      this.states.set(provider, 'half-open');
      return false;
    }

    return true; // Предохранитель всё ещё открыт
  }

  /**
   * Зафиксировать успешный ответ провайдера.
   * Сбрасывает счётчик ошибок и закрывает предохранитель.
   */
  recordSuccess(provider: string): void {
    this.failures.set(provider, 0);
    this.states.set(provider, 'closed');
  }

  /**
   * Зафиксировать ошибку провайдера.
   * Увеличивает счётчик подряд идущих ошибок.
   * При достижении threshold переводит в состояние 'open'.
   */
  recordFailure(provider: string, error?: unknown): void {
    const current = (this.failures.get(provider) ?? 0) + 1;
    this.failures.set(provider, current);
    this.lastFailureTimes.set(provider, Date.now());

    if (current >= this.failureThreshold) {
      this.states.set(provider, 'open');
      console.warn(
        `[circuit-breaker] Провайдер ${provider} превысил лимит сбоев (${current}/${this.failureThreshold}). Circuit breaker OPEN на ${this.cooldownMs / 1000}с. Ошибка:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  /**
   * Получить статус конкретного провайдера.
   */
  getStatus(provider: string): ProviderCircuitStatus {
    const rawState = this.states.get(provider) ?? 'closed';
    const lastTime = this.lastFailureTimes.get(provider) ?? null;
    const now = Date.now();
    const remaining =
      rawState === 'open' && lastTime ? Math.max(0, this.cooldownMs - (now - lastTime)) : 0;

    const effectiveState: CircuitBreakerState = this.isOpen(provider)
      ? 'open'
      : (this.states.get(provider) ?? 'closed');

    return {
      provider,
      state: effectiveState,
      consecutiveFailures: this.failures.get(provider) ?? 0,
      lastFailureTime: lastTime,
      cooldownRemainingMs: remaining,
    };
  }

  /**
   * Получить статус всех зарегистрированных провайдеров.
   */
  getAllStatuses(): ProviderCircuitStatus[] {
    const providers = ['openai', 'anthropic', 'google', 'openrouter'];
    return providers.map((p) => this.getStatus(p));
  }

  /**
   * Сбросить состояние предохранителя.
   */
  reset(provider?: string): void {
    if (provider) {
      this.failures.delete(provider);
      this.states.delete(provider);
      this.lastFailureTimes.delete(provider);
    } else {
      this.failures.clear();
      this.states.clear();
      this.lastFailureTimes.clear();
    }
  }
}

export const defaultCircuitBreaker = new CircuitBreaker({
  failureThreshold: 3,
  cooldownMs: 30_000,
});
