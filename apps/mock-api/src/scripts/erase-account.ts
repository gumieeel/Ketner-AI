/**
 * Удаление аккаунта по запросу владельца — скрипт поддержки.
 *
 *   npm run erase-account -- --user <id аккаунта>            сводка: что будет удалено (ничего не меняет)
 *   npm run erase-account -- --user <id аккаунта> --confirm  удалить
 *
 * Вызывает `eraseAccount` (platform/account-erasure.ts) со всеми зарегистрированными очистками
 * (platform/account-erasure-setup.ts) и печатает, что ещё не зарегистрировано — это удаляется
 * вручную. Нужны DATABASE_URL и BETTER_AUTH_SECRET (токены зашифрованы ключом из него); их значения
 * скрипт не печатает.
 */

import { pathToFileURL } from 'node:url';
import type { SqlRunner } from '../code/postgres-driver.js';
import { config } from '../config.js';
import { createGoogleConnectionStore } from '../google/connection-store.js';
import { attachGoogleStores } from '../google/db.js';
import { createGoogleVerifierStore } from '../google/verifier-store.js';
import {
  AccountErasure,
  eraseAccount,
  formatErasureReport,
  previewAccountErasure,
  type ErasureReport,
} from '../platform/account-erasure.js';
import {
  UNREGISTERED_ACCOUNT_DATA,
  registerAccountErasure,
} from '../platform/account-erasure-setup.js';

export interface EraseAccountArgs {
  userId: string;
  confirm: boolean;
}

export function parseEraseAccountArgs(argv: string[]): EraseAccountArgs | string {
  let userId = '';
  let confirm = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--confirm') confirm = true;
    else if (arg === '--user') userId = argv[++index] ?? '';
    else if (arg?.startsWith('--user=')) userId = arg.slice('--user='.length);
    else return `неизвестный параметр: ${arg}`;
  }
  if (!userId) return 'не указан аккаунт: --user <id>';
  return { userId, confirm };
}

/** Загружает данные из базы, собирает реестр и выполняет сводку или удаление. */
export async function runEraseAccount(
  args: EraseAccountArgs,
  deps: { sql: SqlRunner; secret: string; fetchImpl?: typeof fetch; log?: (line: string) => void },
): Promise<{ report: ErasureReport; text: string }> {
  const connections = createGoogleConnectionStore({ secret: deps.secret });
  const verifiers = createGoogleVerifierStore();
  await attachGoogleStores(deps.sql, { connections, verifiers });

  const registry = new AccountErasure();
  registerAccountErasure(registry, {
    google: { store: connections, verifiers, fetchImpl: deps.fetchImpl, log: deps.log },
  });

  const report = args.confirm
    ? await eraseAccount(args.userId, registry)
    : await previewAccountErasure(args.userId, registry);
  const lines = [formatErasureReport(report), '', 'Ещё без очистки в реестре — удалить вручную:'];
  for (const item of UNREGISTERED_ACCOUNT_DATA) lines.push(`- ${item.area}: ${item.where}`);
  if (!args.confirm) lines.push('', 'Это проверка. Удалить: добавьте --confirm.');
  return { report, text: lines.join('\n') };
}

async function main(): Promise<void> {
  const args = parseEraseAccountArgs(process.argv.slice(2));
  if (typeof args === 'string') {
    console.error(`Ошибка: ${args}`);
    console.error('Использование: npm run erase-account -- --user <id> [--confirm]');
    process.exit(2);
  }
  const url = (config.databaseUrl || process.env.DATABASE_URL || '').trim();
  if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) {
    console.error('Ошибка: DATABASE_URL не задан или не похож на адрес Postgres.');
    process.exit(2);
  }
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, { max: 2, connect_timeout: 15, onnotice: () => {} });
  try {
    const runner: SqlRunner = {
      query: async <T>(text: string, params?: unknown[]) =>
        (await sql.unsafe(text, (params ?? []) as never[])) as unknown as T[],
    };
    const { report, text } = await runEraseAccount(args, {
      sql: runner,
      secret: config.betterAuthSecret,
    });
    console.log(text);
    process.exitCode = report.complete ? 0 : 1;
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    // Только сообщение: без адреса базы и параметров подключения.
    console.error('Ошибка:', error instanceof Error ? error.message : 'неизвестная');
    process.exit(1);
  });
}
