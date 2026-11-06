import type { MemoryBuilderStore } from '../builder/store.js';
import { MemoryAttemptStore } from '../builder/tools/attempt-store.js';
import { MemoryMaterialStore } from '../builder/tools/material-store.js';
import { MemoryRunStore } from '../builder/tools/run-store.js';
import type { Solution, SolutionConfig } from '../builder/types.js';

const NOW = '2026-11-05T10:00:00.000Z';

/** Инструмент «учебный помощник» для тестов: создать его через API пока нельзя (шаблон недоступен). */
export function toolSolution(id: string, ownerId: string): Solution {
  return {
    id,
    ownerId,
    type: 'tool',
    template: 'study_assistant',
    bot: null,
    status: 'active',
    name: `Учёба ${id}`,
    currentVersion: 1,
    activeVersion: 1,
    source: null,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
  };
}

export const STUDY_CONFIG: SolutionConfig = {
  tool: 'study_assistant',
  language: 'ru',
  subject: '',
};

/** Хранилища инструментов в памяти поверх хранилища Builder: материалы, запуски, попытки. */
export function memoryToolStores(builder: MemoryBuilderStore) {
  const solutionOf = (ownerId: string, id: string) => builder.getSolution(ownerId, id);
  const runs = new MemoryRunStore(solutionOf);
  return {
    materials: new MemoryMaterialStore(solutionOf),
    runs,
    attempts: new MemoryAttemptStore((ownerId, solutionId, id) =>
      runs.get(ownerId, solutionId, id),
    ),
  };
}
