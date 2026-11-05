/**
 * Хранилище материалов инструментов: Postgres (миграция `0008_solution_materials`) и память для
 * локальной разработки и тестов. Каждый запрос привязан к владельцу; материал добавляется только
 * в инструмент (`solutions.type = 'tool'`) этого же владельца.
 */
import type { SqlRunner } from '../../code/postgres-driver.js';
import type { Solution } from '../types.js';
import type { Material, MaterialFormat, MaterialSection, MaterialSummary } from './materials.js';
import { summarize } from './materials.js';

export type AddMaterialResult =
  | { status: 'created'; material: Material }
  /** Такой же текст уже загружен в этот инструмент: возвращается прежний материал. */
  | { status: 'duplicate'; material: Material }
  /** Инструмента нет у владельца (или это не инструмент). */
  | { status: 'not_found' };

export interface MaterialStore {
  add(material: Material): Promise<AddMaterialResult>;
  list(ownerId: string, solutionId: string): Promise<MaterialSummary[]>;
  get(ownerId: string, solutionId: string, id: string): Promise<Material | null>;
  remove(ownerId: string, solutionId: string, id: string): Promise<boolean>;
  /** Сколько символов во всех материалах владельца (лимит на пользователя). */
  totalChars(ownerId: string): Promise<number>;
}

/** Память: решения берутся у хранилища Builder, чтобы правило «только свой инструмент» было общим. */
export class MemoryMaterialStore implements MaterialStore {
  private readonly items = new Map<string, Material>();

  constructor(
    private readonly solutionOf: (ownerId: string, id: string) => Promise<Solution | null>,
  ) {}

  async add(material: Material): Promise<AddMaterialResult> {
    const solution = await this.solutionOf(material.ownerId, material.solutionId);
    if (!solution || solution.type !== 'tool') return { status: 'not_found' };
    await this.prune(material.ownerId);
    const existing = [...this.items.values()].find(
      (item) =>
        item.solutionId === material.solutionId && item.contentHash === material.contentHash,
    );
    if (existing) return { status: 'duplicate', material: structuredClone(existing) };
    this.items.set(material.id, structuredClone(material));
    return { status: 'created', material: structuredClone(material) };
  }

  /** Как ON DELETE CASCADE в базе: материалы удалённого решения пропадают. */
  private async prune(ownerId: string): Promise<void> {
    for (const [id, item] of this.items) {
      if (item.ownerId === ownerId && !(await this.solutionOf(ownerId, item.solutionId))) {
        this.items.delete(id);
      }
    }
  }

  async list(ownerId: string, solutionId: string): Promise<MaterialSummary[]> {
    await this.prune(ownerId);
    return [...this.items.values()]
      .filter((item) => item.ownerId === ownerId && item.solutionId === solutionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .map(summarize);
  }

  async get(ownerId: string, solutionId: string, id: string): Promise<Material | null> {
    await this.prune(ownerId);
    const item = this.items.get(id);
    return item && item.ownerId === ownerId && item.solutionId === solutionId
      ? structuredClone(item)
      : null;
  }

  async remove(ownerId: string, solutionId: string, id: string): Promise<boolean> {
    const item = this.items.get(id);
    if (!item || item.ownerId !== ownerId || item.solutionId !== solutionId) return false;
    return this.items.delete(id);
  }

  async totalChars(ownerId: string): Promise<number> {
    await this.prune(ownerId);
    let total = 0;
    for (const item of this.items.values()) if (item.ownerId === ownerId) total += item.charCount;
    return total;
  }
}

interface MaterialRow {
  id: string;
  solution_id: string;
  user_id: string;
  name: string;
  format: MaterialFormat;
  size_bytes: number | string;
  char_count: number | string;
  outline: unknown;
  sections?: unknown;
  content_hash: string;
  created_at: string | Date;
}

const SUMMARY_COLUMNS = `id, solution_id, user_id, name, format, size_bytes, char_count, outline,
  content_hash, created_at`;

function parse<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function toSummary(row: MaterialRow): MaterialSummary {
  return {
    id: row.id,
    solutionId: row.solution_id,
    name: row.name,
    format: row.format,
    sizeBytes: Number(row.size_bytes),
    charCount: Number(row.char_count),
    sections: parse<MaterialSummary['sections']>(row.outline, []),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function toMaterial(row: MaterialRow): Material {
  return {
    id: row.id,
    solutionId: row.solution_id,
    ownerId: row.user_id,
    name: row.name,
    format: row.format,
    sizeBytes: Number(row.size_bytes),
    charCount: Number(row.char_count),
    sections: parse<MaterialSection[]>(row.sections, []),
    contentHash: row.content_hash,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export class PostgresMaterialStore implements MaterialStore {
  constructor(private readonly db: SqlRunner) {}

  async add(material: Material): Promise<AddMaterialResult> {
    const summary = summarize(material);
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO solution_materials
         (id, solution_id, user_id, name, format, size_bytes, char_count, outline, sections,
          content_hash, created_at)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8::text::jsonb, $9::text::jsonb, $10, $11::timestamptz
       WHERE EXISTS (SELECT 1 FROM solutions WHERE id = $2 AND user_id = $3 AND type = 'tool')
       ON CONFLICT (solution_id, content_hash) DO NOTHING
       RETURNING id`,
      [
        material.id,
        material.solutionId,
        material.ownerId,
        material.name,
        material.format,
        material.sizeBytes,
        material.charCount,
        JSON.stringify(summary.sections),
        JSON.stringify(material.sections),
        material.contentHash,
        material.createdAt,
      ],
    );
    if (rows[0]) return { status: 'created', material };
    // Ничего не вставлено: либо такой текст уже есть в этом инструменте, либо инструмент чужой.
    const existing = await this.db.query<MaterialRow>(
      `SELECT ${SUMMARY_COLUMNS}, sections FROM solution_materials
       WHERE solution_id = $1 AND user_id = $2 AND content_hash = $3`,
      [material.solutionId, material.ownerId, material.contentHash],
    );
    return existing[0]
      ? { status: 'duplicate', material: toMaterial(existing[0]) }
      : { status: 'not_found' };
  }

  async list(ownerId: string, solutionId: string): Promise<MaterialSummary[]> {
    const rows = await this.db.query<MaterialRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM solution_materials
       WHERE user_id = $1 AND solution_id = $2 ORDER BY created_at DESC, id DESC`,
      [ownerId, solutionId],
    );
    return rows.map(toSummary);
  }

  async get(ownerId: string, solutionId: string, id: string): Promise<Material | null> {
    const rows = await this.db.query<MaterialRow>(
      `SELECT ${SUMMARY_COLUMNS}, sections FROM solution_materials
       WHERE id = $1 AND user_id = $2 AND solution_id = $3`,
      [id, ownerId, solutionId],
    );
    return rows[0] ? toMaterial(rows[0]) : null;
  }

  async remove(ownerId: string, solutionId: string, id: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      `DELETE FROM solution_materials WHERE id = $1 AND user_id = $2 AND solution_id = $3
       RETURNING id`,
      [id, ownerId, solutionId],
    );
    return rows.length > 0;
  }

  async totalChars(ownerId: string): Promise<number> {
    const rows = await this.db.query<{ total: number | string | null }>(
      `SELECT COALESCE(SUM(char_count), 0) AS total FROM solution_materials WHERE user_id = $1`,
      [ownerId],
    );
    return Number(rows[0]?.total ?? 0);
  }
}
