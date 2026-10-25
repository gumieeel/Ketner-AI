/**
 * Хранение сгенерированных картинок.
 *
 * С БД (Supabase Postgres) картинки лежат в таблице generated_images (bytea): диск Render временный
 * и стирается при каждом деплое. Без БД (локально, в тестах) — файлы на диске. У пользователя
 * хранятся последние MAX_IMAGES_PER_USER картинок, старые удаляются автоматически.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const MAX_IMAGES_PER_USER = 300;

export interface ImageMeta {
  id: string;
  userId: string;
  prompt: string;
  modelId: string;
  width: number;
  height: number;
  mime: string;
  size: number;
  createdAt: string;
}

/** Минимальный интерфейс SQL (postgres.js `sql.unsafe`). */
export interface ImageSqlRunner {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export const IMAGES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS generated_images (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    prompt text NOT NULL,
    model_id text NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    mime text NOT NULL,
    size integer NOT NULL,
    data bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_generated_images_user ON generated_images (user_id, created_at DESC)
`;

export async function ensureImagesSchema(runner: ImageSqlRunner): Promise<void> {
  for (const statement of IMAGES_SCHEMA_SQL.split(';')
    .map((part) => part.trim())
    .filter(Boolean)) {
    await runner.query(statement);
  }
}

interface Row {
  id: string;
  user_id: string;
  prompt: string;
  model_id: string;
  width: number;
  height: number;
  mime: string;
  size: number;
  created_at: Date | string;
  data?: Buffer | Uint8Array;
}

const toMeta = (row: Row): ImageMeta => ({
  id: row.id,
  userId: row.user_id,
  prompt: row.prompt,
  modelId: row.model_id,
  width: Number(row.width),
  height: Number(row.height),
  mime: row.mime,
  size: Number(row.size),
  createdAt: new Date(row.created_at).toISOString(),
});

const META_COLUMNS = 'id, user_id, prompt, model_id, width, height, mime, size, created_at';

export class ImageStore {
  private runner: ImageSqlRunner | null = null;

  constructor(private readonly dir: string) {}

  setDriver(runner: ImageSqlRunner | null): void {
    this.runner = runner;
  }

  private userDir(userId: string): string {
    return path.join(this.dir, createHash('sha256').update(userId).digest('hex').slice(0, 32));
  }

  private readIndex(userId: string): ImageMeta[] {
    const file = path.join(this.userDir(userId), 'index.json');
    if (!existsSync(file)) return [];
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as ImageMeta[];
    } catch {
      return [];
    }
  }

  private writeIndex(userId: string, items: ImageMeta[]): void {
    const dir = this.userDir(userId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'index.json'), JSON.stringify(items));
  }

  async save(
    input: Omit<ImageMeta, 'id' | 'createdAt' | 'size'>,
    bytes: Buffer,
  ): Promise<ImageMeta> {
    const meta: ImageMeta = {
      ...input,
      id: randomUUID(),
      size: bytes.length,
      createdAt: new Date().toISOString(),
    };
    if (this.runner) {
      await this.runner.query(
        `INSERT INTO generated_images (id, user_id, prompt, model_id, width, height, mime, size, data, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          meta.id,
          meta.userId,
          meta.prompt,
          meta.modelId,
          meta.width,
          meta.height,
          meta.mime,
          meta.size,
          bytes,
          meta.createdAt,
        ],
      );
      await this.runner.query(
        `DELETE FROM generated_images WHERE user_id = $1 AND id NOT IN (
           SELECT id FROM generated_images WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2)`,
        [meta.userId, MAX_IMAGES_PER_USER],
      );
      return meta;
    }
    const dir = this.userDir(meta.userId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, meta.id), bytes);
    const items = [meta, ...this.readIndex(meta.userId)];
    for (const old of items.slice(MAX_IMAGES_PER_USER))
      rmSync(path.join(dir, old.id), { force: true });
    this.writeIndex(meta.userId, items.slice(0, MAX_IMAGES_PER_USER));
    return meta;
  }

  async list(userId: string, limit = 100): Promise<ImageMeta[]> {
    if (this.runner) {
      const rows = await this.runner.query<Row>(
        `SELECT ${META_COLUMNS} FROM generated_images WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId, limit],
      );
      return rows.map(toMeta);
    }
    return this.readIndex(userId).slice(0, limit);
  }

  async get(userId: string, id: string): Promise<{ meta: ImageMeta; bytes: Buffer } | null> {
    if (this.runner) {
      const rows = await this.runner.query<Row>(
        `SELECT ${META_COLUMNS}, data FROM generated_images WHERE user_id = $1 AND id = $2`,
        [userId, id],
      );
      const row = rows[0];
      if (!row?.data) return null;
      return { meta: toMeta(row), bytes: Buffer.from(row.data) };
    }
    const meta = this.readIndex(userId).find((item) => item.id === id);
    if (!meta) return null;
    try {
      return { meta, bytes: readFileSync(path.join(this.userDir(userId), id)) };
    } catch {
      return null;
    }
  }

  /** Картинка по id без владельца: для ссылок с подписью (подпись проверяет маршрут). */
  async getById(id: string): Promise<{ meta: ImageMeta; bytes: Buffer } | null> {
    if (this.runner) {
      const rows = await this.runner.query<Row>(
        `SELECT ${META_COLUMNS}, data FROM generated_images WHERE id = $1`,
        [id],
      );
      const row = rows[0];
      if (!row?.data) return null;
      return { meta: toMeta(row), bytes: Buffer.from(row.data) };
    }
    if (!existsSync(this.dir)) return null;
    for (const entry of readdirSync(this.dir)) {
      const indexFile = path.join(this.dir, entry, 'index.json');
      if (!existsSync(indexFile)) continue;
      try {
        const meta = (JSON.parse(readFileSync(indexFile, 'utf8')) as ImageMeta[]).find(
          (item) => item.id === id,
        );
        if (meta) return { meta, bytes: readFileSync(path.join(this.dir, entry, id)) };
      } catch {
        // повреждённый индекс пропускаем
      }
    }
    return null;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    if (this.runner) {
      const rows = await this.runner.query<{ id: string }>(
        'DELETE FROM generated_images WHERE user_id = $1 AND id = $2 RETURNING id',
        [userId, id],
      );
      return rows.length > 0;
    }
    const items = this.readIndex(userId);
    if (!items.some((item) => item.id === id)) return false;
    rmSync(path.join(this.userDir(userId), id), { force: true });
    this.writeIndex(
      userId,
      items.filter((item) => item.id !== id),
    );
    return true;
  }

  /** Только для тестов: очистить локальную папку. */
  clearLocal(): void {
    if (existsSync(this.dir))
      for (const entry of readdirSync(this.dir))
        rmSync(path.join(this.dir, entry), { recursive: true, force: true });
  }
}
