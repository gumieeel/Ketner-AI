import type { Migration } from './migrate.js';

/**
 * Версионные миграции по порядку (правила — в `db/migrate.ts`). Применённую миграцию не меняют и
 * не удаляют: изменение схемы — всегда новая запись в конце списка.
 *
 * Пока пусто: первая миграция появится с таблицами анализов (этап 2, docs/MIGRATION_PLAN.md).
 */
export const MIGRATIONS: readonly Migration[] = [];
