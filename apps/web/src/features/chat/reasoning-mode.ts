import type { User } from '../auth/types';

export type ReasoningMode = 'standard' | 'max';

/**
 * Режим Max открыт всем, у кого есть аккаунт: платят только кредиты (Max дороже обычного режима,
 * цену запроса показывает строка кредитов). Сервер проверяет сам, клиентская проверка нужна
 * гостю, у которого режим не действует.
 */
export function canUseMaxMode(user: Pick<User, 'plan' | 'isVip'> | null | undefined): boolean {
  return Boolean(user);
}

/** Режим, который уходит на сервер с запросом чата и запуском агента. */
export function reasoningModeFor(
  user: Pick<User, 'plan' | 'isVip'> | null | undefined,
  maxMode: boolean,
): ReasoningMode {
  return maxMode && canUseMaxMode(user) ? 'max' : 'standard';
}
