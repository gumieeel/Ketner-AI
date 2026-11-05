/**
 * Каталог операций инструментов — явный список, без регистрации при импорте: что видно здесь, то
 * и умеет исполнитель. Новая операция — модуль с `ToolOperation` и строка в `OPERATIONS`.
 */
import type { ToolOperation } from './operations.js';
import { notesOperation } from './study/notes.js';
import { tableOperation } from './study/table.js';

const OPERATIONS: readonly ToolOperation[] = [notesOperation, tableOperation] as never;

export function getOperation(template: string, id: string): ToolOperation | null {
  return OPERATIONS.find((item) => item.template === template && item.id === id) ?? null;
}

export function operationsOf(template: string): ToolOperation[] {
  return OPERATIONS.filter((item) => item.template === template);
}

export function allOperations(): readonly ToolOperation[] {
  return OPERATIONS;
}
