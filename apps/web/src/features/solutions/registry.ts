import type { SolutionView } from '@/features/builder/api';

/**
 * Какой интерфейс у решения. Источник правды о шаблонах — реестр сервера
 * (apps/mock-api/src/builder/templates.ts); здесь — только какие из них этот сайт умеет показывать.
 *
 * Шаблон без интерфейса (например, решение нового вида, а сайт старее сервера) получает честное
 * «не поддерживается», а не чат помощника.
 */
export type SolutionInterface = 'assistant' | 'study';

const INTERFACE_BY_TEMPLATE: Readonly<Record<string, SolutionInterface>> = {
  personal_assistant: 'assistant',
  customer_bot: 'assistant',
  study_assistant: 'study',
};

/** Какому виду решения соответствует интерфейс. */
const KIND_OF_INTERFACE: Readonly<Record<SolutionInterface, SolutionView['kind']>> = {
  assistant: 'assistant',
  study: 'tool',
};

export function solutionInterface(
  solution: Pick<SolutionView, 'kind' | 'template'>,
): SolutionInterface | null {
  const ui = INTERFACE_BY_TEMPLATE[solution.template];
  // Вид решения должен совпадать с интерфейсом: шаблон помощника с видом «инструмент» — ошибка данных.
  return ui && KIND_OF_INTERFACE[ui] === solution.kind ? ui : null;
}
