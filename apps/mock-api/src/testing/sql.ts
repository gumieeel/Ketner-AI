import type { SqlRunner } from '../code/postgres-driver.js';
import type { MigrationDb } from '../db/migrate.js';

/**
 * Настоящий SQL: PGlite (если установлен, как в code/postgres-driver.test.ts) или Postgres из
 * TEST_DATABASE_URL. Без них тест пропускается.
 */
export async function openTestSql(): Promise<{
  runner: SqlRunner;
  db: MigrationDb;
  close: () => Promise<void>;
} | null> {
  const url = process.env.TEST_DATABASE_URL;
  if (url) {
    const { default: postgres } = await import('postgres');
    const sql = postgres(url, { onnotice: () => {}, max: 4 });
    const schema = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    await sql.unsafe(`CREATE SCHEMA ${schema}`);
    await sql.unsafe(`SET search_path TO ${schema}`);
    const scoped = postgres(url, {
      onnotice: () => {},
      max: 4,
      connection: { search_path: schema },
    });
    const asRows = <T>(rows: unknown) => rows as T[];
    const runner: SqlRunner = {
      query: async <T>(text: string, params?: unknown[]) =>
        asRows<T>(await scoped.unsafe(text, (params ?? []) as never[])),
    };
    return {
      runner,
      db: {
        ...runner,
        transaction: async (body) =>
          (await scoped.begin((tx) =>
            body({
              query: async <T>(t: string, p?: unknown[]) =>
                asRows<T>(await tx.unsafe(t, (p ?? []) as never[])),
            }),
          )) as never,
      },
      close: async () => {
        await scoped.end();
        await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`);
        await sql.end();
      },
    };
  }
  try {
    const specifier = process.env.PGLITE_MODULE ?? '@electric-sql/pglite';
    const mod = (await import(specifier)) as {
      PGlite: new () => {
        query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }>;
        exec: (t: string) => Promise<unknown>;
        transaction: <T>(
          fn: (tx: {
            query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }>;
            exec: (t: string) => Promise<unknown>;
          }) => Promise<T>,
        ) => Promise<T>;
        close: () => Promise<void>;
      };
    };
    const pg = new mod.PGlite();
    type Client = Pick<InstanceType<typeof mod.PGlite>, 'query' | 'exec'>;
    // Без параметров — exec: миграция состоит из нескольких операторов.
    const run =
      (client: Client) =>
      async <T>(text: string, params?: unknown[]) =>
        params && params.length > 0
          ? ((await client.query(text, params)).rows as T[])
          : ((((await client.exec(text)) as Array<{ rows: unknown[] }>).at(-1)?.rows ?? []) as T[]);
    const runner: SqlRunner = { query: run(pg) };
    return {
      runner,
      db: { ...runner, transaction: (body) => pg.transaction((tx) => body({ query: run(tx) })) },
      close: () => pg.close(),
    };
  } catch {
    return null;
  }
}
