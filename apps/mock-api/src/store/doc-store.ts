import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Небольшое хранилище документов (JSON-файл + зеркало в Postgres-таблицу `ketner_docs`).
 * Для данных, которые должны пережить деплой: диск Render временный.
 */
export interface DocDbDriver<T> {
  upsert(namespace: string, doc: T): Promise<void>;
  remove(namespace: string, id: string): Promise<void>;
}

export class DocStore<T extends { id: string }> {
  private docs = new Map<string, T>();
  private dbDriver: DocDbDriver<T> | null = null;

  constructor(
    readonly namespace: string,
    private readonly file?: string,
  ) {
    if (file) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as { docs?: T[] };
        for (const doc of parsed.docs ?? []) this.docs.set(doc.id, doc);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn(`[mock-api] хранилище ${namespace} не прочитано:`, error);
        }
      }
    }
  }

  get(id: string): T | undefined {
    const doc = this.docs.get(id);
    return doc ? structuredClone(doc) : undefined;
  }

  all(): T[] {
    return [...this.docs.values()].map((doc) => structuredClone(doc));
  }

  filter(predicate: (doc: T) => boolean): T[] {
    return this.all().filter(predicate);
  }

  put(doc: T): T {
    this.docs.set(doc.id, structuredClone(doc));
    this.persist();
    this.dbDriver?.upsert(this.namespace, structuredClone(doc)).catch((error: unknown) => {
      console.error(`[db] Ошибка записи ${this.namespace}:`, error);
    });
    return structuredClone(doc);
  }

  remove(id: string): boolean {
    const existed = this.docs.delete(id);
    if (existed) {
      this.persist();
      this.dbDriver?.remove(this.namespace, id).catch((error: unknown) => {
        console.error(`[db] Ошибка удаления ${this.namespace}:`, error);
      });
    }
    return existed;
  }

  loadExternal(docs: T[]): void {
    for (const doc of docs) this.docs.set(doc.id, doc);
  }

  setDbDriver(driver: DocDbDriver<T> | null): void {
    this.dbDriver = driver;
  }

  private persist(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, `${JSON.stringify({ docs: [...this.docs.values()] }, null, 2)}\n`, 'utf8');
      renameSync(temporary, this.file);
    } catch (error) {
      console.error(`[mock-api] Ошибка записи ${this.namespace}:`, error);
    }
  }
}
