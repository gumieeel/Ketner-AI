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
