/**
 * Пилот анализа v2 (docs/ANALYSIS_V2.md, «B6-pilot»): для этих аккаунтов этап поиска возможностей
 * идёт на Claude Sonnet 5.5 (effort medium) с промптом v2; остальные — как раньше. Тот же приём,
 * что у пилота Google Таблиц: список только на сервере, в коде. Перед включением для всех —
 * сравнение B5.
 */

export const ANALYSIS_V2_PILOT_ACCOUNTS: readonly string[] = [
  'c4b78d88-6aee-4183-bd19-33a40e9ffece', // владелец
];

let override: readonly string[] | null = null;

/** Только для тестов: свой список пилота; `null` — список из кода. */
export function setAnalysisV2PilotForTests(accounts: readonly string[] | null): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('analysis pilot cannot be changed in production');
  }
  override = accounts;
}

/** Аккаунт в пилоте анализа v2. Гости в пилот не входят. */
export function analysisV2PilotFor(userId: string | null | undefined): boolean {
  return Boolean(userId) && (override ?? ANALYSIS_V2_PILOT_ACCOUNTS).includes(userId!);
}
