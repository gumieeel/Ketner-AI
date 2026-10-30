/**
 * Версионные миграции Postgres.
 *
 * Существующие таблицы по-прежнему создаются кодом при старте (`db/sync.ts`, `CREATE … IF NOT EXISTS`);
 * их перенос сюда — отдельная задача. Новые таблицы платформы решений (анализы, планы, решения)
 * создаются только миграциями из `db/migration-list.ts`: так изменение схемы видно в истории, применяется
 * один раз и в одном порядке на любой базе.
 *
 * Правила:
 *   - id миграции — `NNNN_имя` (четыре цифры, латиница, цифры, `_`), список строго по возрастанию;
 *   - применённая миграция не меняется: её контрольная сумма записана в `schema_migrations`, и при
 *     расхождении раннер останавливается, ничего не применяя дальше;
 *   - каждая миграция — в своей транзакции под advisory-lock: при ошибке она откатывается целиком и не
 *     отмечается применённой;
 *   - миграции только добавляют (таблицы, колонки, индексы); удаление — отдельной миграцией после
 *     согласования.
 */

import { createHash } from 'node:crypto';

export interface Migration {
  /** `NNNN_имя`, например `0001_discovery`. */
  id: string;
  /** SQL одной миграции; можно несколько операторов через `;`. */
  sql: string;
}

/** Минимальный доступ к базе: postgres.js (`sql.unsafe`, `sql.begin`) и поддельная база в тестах. */
export interface MigrationQuery {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface MigrationDb extends MigrationQuery {
  transaction<T>(run: (tx: MigrationQuery) => Promise<T>): Promise<T>;
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

/** Применённая миграция изменена после выкладки: схема на базе и в коде разошлись. */
export class MigrationChecksumError extends Error {
  constructor(readonly migrationId: string) {
    super(
      `Миграция ${migrationId} уже применена, но её текст изменился. Применённые миграции не меняют: ` +
        'нужна новая миграция.',
    );
    this.name = 'MigrationChecksumError';
  }
}

const MIGRATION_ID = /^\d{4}_[a-z0-9_]+$/;
/** Ключ advisory-lock: два процесса не применяют одну миграцию одновременно. */
const MIGRATION_LOCK_KEY = 4_217_001;

export const SCHEMA_MIGRATIONS_SQL = `
  CREATE TABLE IF NOT EXISTS "schema_migrations" (
    "id" text PRIMARY KEY,
    "checksum" text NOT NULL,
    "applied_at" timestamptz NOT NULL DEFAULT now()
  )
`;

export function migrationChecksum(migration: Migration): string {
  return createHash('sha256').update(migration.sql.trim()).digest('hex');
}

/** Список корректен: id в формате, без повторов, строго по возрастанию. */
export function validateMigrationList(migrations: readonly Migration[]): void {
  let previous = '';
  for (const migration of migrations) {
    if (!MIGRATION_ID.test(migration.id)) {
      throw new Error(`Неверный id миграции «${migration.id}»: нужен формат NNNN_имя`);
    }
    if (migration.id <= previous) {
      throw new Error(
        `Миграции не по порядку или повторяются: «${migration.id}» после «${previous}»`,
      );
    }
    if (!migration.sql.trim()) {
      throw new Error(`Миграция ${migration.id} пустая`);
    }
    previous = migration.id;
  }
}

/**
 * Применяет недостающие миграции по порядку. Уже применённые с той же контрольной суммой пропускает,
 * изменённую применённую — останавливает с `MigrationChecksumError`.
 */
export async function runMigrations(
  db: MigrationDb,
  migrations: readonly Migration[],
  log: (message: string) => void = () => {},
): Promise<MigrationResult> {
  validateMigrationList(migrations);
  await db.query(SCHEMA_MIGRATIONS_SQL);

  const result: MigrationResult = { applied: [], alreadyApplied: [] };
  for (const migration of migrations) {
    const checksum = migrationChecksum(migration);
    const applied = await db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
      const rows = await tx.query<{ checksum: string }>(
        'SELECT "checksum" FROM "schema_migrations" WHERE "id" = $1',
        [migration.id],
      );
      const existing = rows[0];
      if (existing) {
        if (existing.checksum !== checksum) throw new MigrationChecksumError(migration.id);
        return false;
      }
      await tx.query(migration.sql);
      await tx.query('INSERT INTO "schema_migrations" ("id", "checksum") VALUES ($1, $2)', [
        migration.id,
        checksum,
      ]);
      return true;
    });
    if (applied) {
      result.applied.push(migration.id);
      log(`[db] миграция ${migration.id} применена`);
    } else {
      result.alreadyApplied.push(migration.id);
    }
  }
  return result;
}

/** Состояние миграций в этом процессе: новые функции проверяют его перед работой со своими таблицами. */
export type MigrationState =
  | { status: 'not_run' }
  | { status: 'ok'; result: MigrationResult }
  | { status: 'failed'; error: string };

let migrationState: MigrationState = { status: 'not_run' };

export function getMigrationState(): MigrationState {
  return migrationState;
}

export function setMigrationState(state: MigrationState): void {
  migrationState = state;
}
