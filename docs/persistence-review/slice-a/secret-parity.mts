// Правила секретов кода (platform/secrets.ts) и базы (platform_contains_secret) совпадают на общем наборе
// примеров (platform/secret-corpus.ts); очищенный кодом документ база не отклоняет.
// Запуск: npx tsx secret-parity.mts <postgres-url> (после Slice A).
import postgres from '../../../node_modules/postgres/src/index.js';
import { SECRET_CORPUS } from '../../../apps/mock-api/src/platform/secret-corpus.ts';
import { containsSecret, sanitizeForJournal } from '../../../apps/mock-api/src/platform/secrets.ts';

const sql = postgres(process.argv[2]!, { onnotice: () => {}, max: 1 });
let passed = 0;
let failed = 0;
for (const item of SECRET_CORPUS) {
  const [{ db }] = await sql<
    { db: boolean }[]
  >`SELECT platform_contains_secret(${sql.json(item.doc as never)}::jsonb) AS db`;
  const code = containsSecret(item.doc);
  const sanitized = sanitizeForJournal(item.doc).value;
  const [{ after }] = await sql<
    { after: boolean }[]
  >`SELECT platform_contains_secret(${sql.json(sanitized as never)}::jsonb) AS after`;
  const ok = db === item.secret && code === item.secret && after === false;
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${item.secret ? 'secret    ' : 'not secret'}  ${item.name}${ok ? '' : `  (db=${db} code=${code} sanitized_db=${after})`}`,
  );
}
console.log(`secret parity: passed=${passed} failed=${failed}`);
await sql.end();
process.exitCode = failed === 0 ? 0 : 1;
