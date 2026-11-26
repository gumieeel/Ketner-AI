/**
 * Мастер решения (docs/BUILDER_V1.md, разделы 3 и 12): четыре шага с одними подписями для всех
 * типов. Все четыре шага — для ИИ-агента для клиентов (`customer_bot`).
 */

/**
 * Ведёт ли отчёт анализа в мастер. Пока false — кнопки отчёта работают как раньше, а мастер открыт
 * по прямому адресу `/solutions/new?…` и `/solutions/<id>/setup` для проверки. Включить — правкой
 * здесь и ревью.
 */
export const BUILDER_WIZARD_LIVE = false;

export const WIZARD_STEPS = ['analysis', 'setup', 'connections', 'launch'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export function wizardStartPath(analysisId: string, opportunityId: string): string {
  const query = new URLSearchParams({ analysis: analysisId, opportunity: opportunityId });
  return `/solutions/new?${query.toString()}`;
}

export function wizardSetupPath(solutionId: string): string {
  return `/solutions/${encodeURIComponent(solutionId)}/setup`;
}

export function wizardConnectionsPath(solutionId: string): string {
  return `/solutions/${encodeURIComponent(solutionId)}/connections`;
}

export function wizardLaunchPath(solutionId: string): string {
  return `/solutions/${encodeURIComponent(solutionId)}/launch`;
}
