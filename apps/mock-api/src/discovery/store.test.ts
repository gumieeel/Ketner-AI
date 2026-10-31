import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../db/migrate.js';
import { MIGRATIONS } from '../db/migration-list.js';
import { openTestSql } from '../testing/sql.js';
import { MemoryDiscoveryStore, PostgresDiscoveryStore, type DiscoveryStore } from './store.js';
import type { Analysis, Opportunity } from './types.js';

function analysis(overrides: Partial<Analysis> = {}): Analysis {
  const now = '2026-10-30T10:00:00.000Z';
  return {
    id: `a-${Math.random().toString(36).slice(2, 10)}`,
    ownerId: 'alice',
    guest: false,
    ipHash: 'ip-1',
    ipLimited: true,
    mode: 'free',
    language: 'ru',
    status: 'analyzing',
    inputText: 'Веду учёт заказов вручную',
    context: null,
    questions: [],
    answers: {},
    summary: null,
    stages: {
      context: { status: 'pending', taskId: 't1', costUsd: 0, creditsUsd: 0, attempts: 0 },
    },
    budgetDay: '2026-10-30',
    idempotencyKey: null,
    saved: false,
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

function opportunity(analysisId: string, ownerId: string, position: number): Opportunity {
  return {
    id: `o-${analysisId}-${position}`,
    analysisId,
    ownerId,
    position,
    title: `Возможность ${position}`,
    problem: 'п',
    solution: 'р',
    requires: ['text_generation'],
    otherRequirement: null,
    dataNeeded: [],
    integrationsNeeded: [],
    effort: 'low',
    effortReason: '',
    risks: [],
    limitations: [],
    successCriteria: [],
    firstStep: '',
    feasibilityStatus: 'ready',
    feasibility: { status: 'ready', blockers: [], available: [] },
    impact: { kind: 'qualitative', benefit: 'польза', missing: 'частота', note: 'прогноз' },
    priority: position,
    createdAt: '2026-10-30T10:00:00.000Z',
  };
}

async function storeContract(store: DiscoveryStore): Promise<void> {
  // Идемпотентность: тот же ключ того же владельца — тот же анализ; у другого владельца — свой.
  const first = await store.create(analysis({ id: 'k1', idempotencyKey: 'key-12345678' }));
  assert.equal(first.duplicate, false);
  const again = await store.create(analysis({ id: 'k2', idempotencyKey: 'key-12345678' }));
  assert.equal(again.duplicate, true);
  assert.equal(again.analysis.id, 'k1');
  const other = await store.create(
    analysis({ id: 'k3', ownerId: 'bob', idempotencyKey: 'key-12345678' }),
  );
  assert.equal(other.duplicate, false);

  // Чужой анализ не читается и не меняется.
  assert.equal(await store.get('bob', 'k1'), null);
  const mine = (await store.get('alice', 'k1')) as Analysis;
  assert.equal(await store.update({ ...mine, ownerId: 'bob', status: 'ready' }, 1), null);

  // Версия защищает от одновременной записи.
  const updated = await store.update(
    {
      ...mine,
      status: 'needs_answers',
      context: {
        domain: 'd',
        summary: 's',
        goals: [],
        tasks: [],
        recurringProcesses: [],
        tools: [],
        constraints: [],
        availableData: [],
        missing: [],
        questions: [],
      },
    },
    1,
  );
  assert.equal(updated?.version, 2);
  assert.equal(updated?.context?.domain, 'd');
  assert.equal(await store.update({ ...mine, status: 'ready' }, 1), null, 'устаревшая версия');

  // Возможности — только владельца.
  await store.setOpportunities('alice', 'k1', [
    opportunity('k1', 'alice', 1),
    opportunity('k1', 'alice', 0),
  ]);
  await store.setOpportunities('bob', 'k1', [opportunity('k1', 'bob', 5)]);
  const items = await store.opportunities('alice', 'k1');
  assert.deepEqual(
    items.map((item) => item.position),
    [0, 1],
  );
  assert.equal(items[0].impact.kind, 'qualitative');
  assert.deepEqual(await store.opportunities('bob', 'k1'), []);

  // Подсчёт для лимитов.
  await store.create(analysis({ id: 'g1', ownerId: 'guest_abcdefgh', guest: true, mode: 'free' }));
  await store.create(analysis({ id: 'p1', mode: 'paid', ipLimited: false }));
  assert.equal(await store.count({ ownerId: 'alice', budgetDay: '2026-10-30', mode: 'free' }), 1);
  assert.equal(
    await store.count({ ipHash: 'ip-1', budgetDay: '2026-10-30', mode: 'free', ipLimited: true }),
    3,
  );
  assert.equal(await store.count({ ownerId: 'alice', budgetDay: '2026-10-30' }), 2);
  assert.equal(await store.count({ ownerId: 'alice', budgetDay: '2026-10-31' }), 0);

  // Перенос гостя: только из своего гостевого id.
  assert.equal(await store.claimGuest('mallory', 'guest_other1234', 'g1'), false);
  assert.equal(await store.claimGuest('carol', 'guest_abcdefgh', 'g1'), true);
  assert.equal((await store.get('carol', 'g1'))?.guest, false);
  assert.equal(await store.get('guest_abcdefgh', 'g1'), null);
  assert.equal(await store.claimGuest('dave', 'guest_abcdefgh', 'g1'), false);
  assert.equal(await store.claimGuest('carol', 'guest_abcdefgh', 'g1'), true, 'уже свой');

  const list = await store.list('alice', 10);
  assert.ok(list.every((item) => item.ownerId === 'alice'));

  // «Сохранить анализ» хранится вместе с записью.
  const current = (await store.get('alice', 'k1')) as Analysis;
  const saved = await store.update({ ...current, saved: true }, current.version);
  assert.equal(saved?.saved, true);
  assert.equal((await store.get('alice', 'k1'))?.saved, true);

  // Удаление: чужой не удаляет; запись скрыта, содержимое и возможности стёрты, лимиты помнят её.
  const before = await store.count({ ownerId: 'alice', budgetDay: '2026-10-30', mode: 'free' });
  assert.equal(await store.remove('bob', 'k1', '2026-10-30T12:00:00.000Z'), false);
  assert.equal(await store.remove('alice', 'k1', '2026-10-30T12:00:00.000Z'), true);
  assert.equal(await store.remove('alice', 'k1', '2026-10-30T12:00:00.000Z'), false, 'уже удалён');
  assert.equal(await store.get('alice', 'k1'), null);
  assert.ok((await store.list('alice', 10)).every((item) => item.id !== 'k1'));
  assert.deepEqual(await store.opportunities('alice', 'k1'), []);
  assert.equal(await store.update({ ...current, saved: false }, (saved?.version ?? 0) + 1), null);
  assert.equal(
    await store.count({ ownerId: 'alice', budgetDay: '2026-10-30', mode: 'free' }),
    before,
    'удаление не обнуляет суточный лимит',
  );
}

test('хранилище анализов в памяти: владелец, идемпотентность, версии, перенос гостя', async () => {
  await storeContract(new MemoryDiscoveryStore());
});

test('хранилище анализов в Postgres: та же логика, JSON хранится объектами', async (t) => {
  const sql = await openTestSql();
  if (!sql) {
    t.skip('нет PGlite и TEST_DATABASE_URL');
    return;
  }
  try {
    await runMigrations(sql.db, MIGRATIONS);
    await storeContract(new PostgresDiscoveryStore(sql.runner));
    const rows = await sql.runner.query<{ kind: string }>(
      `SELECT jsonb_typeof(stage_runs) AS kind FROM discovery_analyses WHERE id = 'k3'`,
    );
    assert.equal(rows[0]?.kind, 'object', 'jsonb — объект, а не строка с JSON');
    const wiped = await sql.runner.query<{ input_text: string; deleted: boolean }>(
      `SELECT input_text, deleted_at IS NOT NULL AS deleted FROM discovery_analyses WHERE id = 'k1'`,
    );
    assert.deepEqual(wiped[0], { input_text: '', deleted: true }, 'текст удалённого стёрт');
  } finally {
    await sql.close();
  }
});
