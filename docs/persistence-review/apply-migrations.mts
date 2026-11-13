// Накатывает существующие миграции 0001–0012 настоящим раннером приложения (как при старте сервера):
// транзакция и advisory-lock на миграцию, запись id и контрольной суммы в schema_migrations.
// Запуск: npx tsx apply-migrations.mts <postgres-url> [последняя-миграция]
// Второй аргумент ограничивает список (например, 0012_implementation_pricing): в ветке с Slice A в
// migration-list.ts стенды накатывают 0001–0012 раннером, а предложение — своим файлом.
import postgres from '../../node_modules/postgres/src/index.js';
import { runMigrations, type MigrationDb } from '../../apps/mock-api/src/db/migrate.ts';
import { MIGRATIONS } from '../../apps/mock-api/src/db/migration-list.ts';

const sql = postgres(process.argv[2]!, { onnotice: () => {}, max: 1 });
const db: MigrationDb = {
  query: async (text, params) => (await sql.unsafe(text, (params ?? []) as never[])) as never,
  transaction: async (body) =>
    (await sql.begin((tx) =>
      body({
        query: async (text, params) => (await tx.unsafe(text, (params ?? []) as never[])) as never,
      }),
    )) as never,
};
const until = process.argv[3];
const list = until ? MIGRATIONS.filter((item) => item.id <= until) : MIGRATIONS;
const result = await runMigrations(db, list);
console.log(
  `runner: applied ${result.applied.length} (${result.applied[0]} … ${result.applied.at(-1)}), already ${result.alreadyApplied.length}`,
);
await sql.end();
