import type { User } from '../auth/types';

export type ReasoningMode = 'standard' | 'max';

/**
 * Режим Max доступен только на Ultra (VIP получает Ultra на сервере). Сервер проверяет тариф сам:
 * клиентская проверка нужна, чтобы не показывать включённый режим тем, у кого он не действует.
 */
export function canUseMaxMode(user: Pick<User, 'plan' | 'isVip'> | null | undefined): boolean {
  return Boolean(user && (user.plan === 'ultra' || user.isVip));
}

/** Режим, который уходит на сервер с запросом чата и запуском агента. */
export function reasoningModeFor(
  user: Pick<User, 'plan' | 'isVip'> | null | undefined,
  maxMode: boolean,
): ReasoningMode {
  return maxMode && canUseMaxMode(user) ? 'max' : 'standard';
}
