/**
 * Хранение проектов Ketner Code в PostgreSQL.
 *
 * Диск сервера остаётся рабочей копией (команды и поиск работают с файлами), а БД — долговечной:
 * после перезапуска на хостинге с временным диском проект лениво поднимается из БД при первом
 * обращении (ProjectStore.hydrateFromDriver). Запись в БД идёт в фоне и не тормозит правки.
 * Все запросы параметризованы и привязаны к владельцу проекта (user_id).
 */

import type { ProjectDbDriver } from './project-store.js';
import type { ProjectMeta, ProjectSource, ThreadItem } from './types.js';

/** Минимальный интерфейс SQL: postgres.js (`sql.unsafe`) и PGlite в тестах подходят одинаково. */
export interface SqlRunner {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export const CODE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS code_projects (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    name text NOT NULL,
    description text,
    source jsonb NOT NULL DEFAULT '{"type":"empty"}'::jsonb,
    file_count integer NOT NULL DEFAULT 0,
    total_bytes bigint NOT NULL DEFAULT 0,
    thread jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_code_projects_user ON code_projects (user_id);
  CREATE TABLE IF NOT EXISTS code_project_files (
    project_id text NOT NULL,
    path text NOT NULL,
    content text NOT NULL,
    size integer NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, path)
  );
`;

export async function ensureCodeSchema(runner: SqlRunner): Promise<void> {
  for (const statement of CODE_SCHEMA_SQL.split(';').map((part) => part.trim()).filter(Boolean)) {
    await runner.query(statement);
  }
}

interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  source: ProjectSource | string;
  file_count: number | string;
  total_bytes: number | string;
  created_at: Date | string;
  updated_at: Date | string;
}

const iso = (value: Date | string): string => new Date(value).toISOString();

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value as T) ?? fallback;
}

function toMeta(row: ProjectRow): ProjectMeta {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    source: parseJson<ProjectSource>(row.source, { type: 'empty' }),
    fileCount: Number(row.file_count),
    totalBytes: Number(row.total_bytes),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** PostgreSQL не хранит нулевой байт в text; в рабочей копии на диске файл остаётся как есть. */
const forDb = (content: string): string => content.replace(/\u0000/g, '');

export function createPostgresProjectDriver(runner: SqlRunner): ProjectDbDriver {
  return {
    async listProjects(userId) {
      const rows = await runner.query<ProjectRow>(
        'SELECT id, user_id, name, description, source, file_count, total_bytes, created_at, updated_at FROM code_projects WHERE user_id = $1 ORDER BY updated_at DESC',
        [userId],
      );
      return rows.map(toMeta);
    },

    async loadProject(userId, projectId) {
      const rows = await runner.query<ProjectRow & { thread: unknown }>(
        'SELECT id, user_id, name, description, source, file_count, total_bytes, thread, created_at, updated_at FROM code_projects WHERE id = $1 AND user_id = $2',
        [projectId, userId],
      );
      if (rows.length === 0) return null;
      const files = await runner.query<{ path: string; content: string }>(
        'SELECT path, content FROM code_project_files WHERE project_id = $1 ORDER BY path',
        [projectId],
      );
      return {
        meta: toMeta(rows[0]),
        thread: parseJson<ThreadItem[]>(rows[0].thread, []),
        files,
      };
    },

    async saveProject(meta) {
      await runner.query(
        `INSERT INTO code_projects (id, user_id, name, description, source, file_count, total_bytes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           source = EXCLUDED.source,
           file_count = EXCLUDED.file_count,
           total_bytes = EXCLUDED.total_bytes,
           updated_at = EXCLUDED.updated_at
         WHERE code_projects.user_id = EXCLUDED.user_id`,
        [
          meta.id,
          meta.userId,
          meta.name,
          meta.description ?? null,
          JSON.stringify(meta.source),
          meta.fileCount,
          meta.totalBytes,
          meta.createdAt,
          meta.updatedAt,
        ],
      );
    },

    async saveThread(userId, projectId, thread) {
      await runner.query('UPDATE code_projects SET thread = $3::jsonb WHERE id = $1 AND user_id = $2', [
        projectId,
        userId,
        JSON.stringify(thread),
      ]);
    },

    async deleteProject(userId, projectId) {
      await runner.query(
        'DELETE FROM code_project_files WHERE project_id = $1 AND EXISTS (SELECT 1 FROM code_projects WHERE id = $1 AND user_id = $2)',
        [projectId, userId],
      );
      await runner.query('DELETE FROM code_projects WHERE id = $1 AND user_id = $2', [projectId, userId]);
    },

    async saveFile(userId, projectId, file) {
      await runner.query(
        `INSERT INTO code_project_files (project_id, path, content, size, updated_at)
         SELECT $1, $3, $4, $5, now()
         WHERE EXISTS (SELECT 1 FROM code_projects WHERE id = $1 AND user_id = $2)
         ON CONFLICT (project_id, path) DO UPDATE SET content = EXCLUDED.content, size = EXCLUDED.size, updated_at = now()`,
        [projectId, userId, file.path, forDb(file.content), file.size],
      );
    },

    async deleteFile(userId, projectId, filePath) {
      await runner.query(
        'DELETE FROM code_project_files WHERE project_id = $1 AND path = $3 AND EXISTS (SELECT 1 FROM code_projects WHERE id = $1 AND user_id = $2)',
        [projectId, userId, filePath],
      );
    },
  };
}
