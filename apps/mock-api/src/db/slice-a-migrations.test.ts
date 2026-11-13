import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { MIGRATIONS } from './migration-list.js';

// Slice A (docs/PERSISTENCE_SLICE_A.sql) — один источник: каждая запись 0013–0015 в migration-list.ts
// дословно совпадает со своим разделом документа, по которому шла проверка на стенде.
const doc = readFileSync(
  new URL('../../../../docs/PERSISTENCE_SLICE_A.sql', import.meta.url),
  'utf8',
);
const BAR =
  '-- =================================================================================================';

function sections(): Map<string, string> {
  const result = new Map<string, string>();
  const starts = [...doc.matchAll(new RegExp(`${BAR}\\n-- (001[345]_[a-z_]+)`, 'g'))];
  starts.forEach((match, index) => {
    const end = index + 1 < starts.length ? starts[index + 1]!.index : doc.length;
    result.set(match[1]!, doc.slice(match.index, end).replace(/^\n+|\n+$/g, ''));
  });
  return result;
}

test('Slice A: записи миграций дословно совпадают с разделами docs/PERSISTENCE_SLICE_A.sql', () => {
  const docSections = sections();
  assert.deepEqual(
    [...docSections.keys()],
    [
      '0013_platform_agent_specs',
      '0014_platform_agent_deployments',
      '0015_platform_agent_executions',
    ],
  );
  for (const [id, text] of docSections) {
    const migration = MIGRATIONS.find((item) => item.id === id);
    assert.ok(migration, `${id} в migration-list.ts`);
    assert.equal(migration.sql.replace(/^\n+|\n+$/g, ''), text, id);
  }
  // Обратные косые черты регулярных выражений не потерялись (String.raw).
  const specs = MIGRATIONS.find((item) => item.id === '0013_platform_agent_specs')!;
  assert.ok(specs.sql.includes(String.raw`'\msk-[A-Za-z0-9]`));
  assert.deepEqual(
    MIGRATIONS.slice(-3).map((item) => item.id),
    [...docSections.keys()],
    'Slice A — последние записи списка',
  );
});
