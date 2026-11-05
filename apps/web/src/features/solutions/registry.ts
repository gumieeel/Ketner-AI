import type { SolutionView } from '@/features/builder/api';

/**
 * Какой интерфейс у решения. Источник правды о шаблонах — реестр сервера
 * (apps/mock-api/src/builder/templates.ts); здесь — только какие из них этот сайт умеет показывать.
 *
 * Шаблон без интерфейса (например, решение нового вида, а сайт старее сервера) получает честное
 * «не поддерживается», а не чат помощника.
 */
export type SolutionInterface = 'assistant';

const INTERFACE_BY_TEMPLATE: Readonly<Record<string, SolutionInterface>> = {
  personal_assistant: 'assistant',
  customer_bot: 'assistant',
};

export function solutionInterface(
  solution: Pick<SolutionView, 'kind' | 'template'>,
): SolutionInterface | null {
  const ui = INTERFACE_BY_TEMPLATE[solution.template];
  // Вид решения должен совпадать с интерфейсом: шаблон помощника с видом «инструмент» — ошибка данных.
  return ui && ui === solution.kind ? ui : null;
}
