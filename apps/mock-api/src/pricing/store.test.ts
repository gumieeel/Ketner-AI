import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../db/migrate.js';
import { MIGRATIONS } from '../db/migration-list.js';
import { openTestSql } from '../testing/sql.js';
import { DEFAULT_CATALOG, DEFAULT_PRICING_CONFIG } from './catalog.js';
import { estimate } from './engine.js';
import { MemoryPricingStore, PostgresPricingStore, type PricingStore } from './store.js';
import type { ImplementationRequest, StoredEstimate } from './types.js';
import { monthlyCosts } from './usage.js';

const NOW = '2026-11-07T10:00:00.000Z';

function sampleEstimate(
  id: string,
  analysisId: string,
  generation: number,
  scopeKey: string,
): StoredEstimate {
  const result = estimate(
    [
      {
        id: 'o1',
        title: 'Бот',
        solutionType: 'assistant',
        workItems: [
          { capability: 'telegram_integration', quantity: 1, complexity: 'medium', reason: '' },
        ],
        unknowns: [],
        assumptions: [],
        derived: false,
      },
    ],
    DEFAULT_CATALOG,
    DEFAULT_PRICING_CONFIG,
    { monthlyRequests: null, missing: [] },
  );
  return {
    id,
    analysisId,
    generation,
    scope: 'opportunity',
    scopeKey,
    opportunityIds: ['o1'],
    pricingVersion: 1,
    fingerprint: 'f',
    opportunityTitles: { o1: 'Бот' },
    result,
    monthly: monthlyCosts(result.lines, null, DEFAULT_PRICING_CONFIG),
    createdAt: NOW,
  };
}

function sampleRequest(
  snapshot: StoredEstimate,
  userId: string,
  key: string | null,
): ImplementationRequest {
  return {
    id: `r-${key ?? Math.random()}`,
    userId,
    analysisId: snapshot.analysisId,
    estimateId: snapshot.id,
    scope: 'opportunity',
    opportunityIds: ['o1'],
    customerMessage: 'Хочу внедрить',
    contact: { name: 'Айгерим', phone: '+77001234567', email: null },
    status: 'new',
    snapshot,
    industry: 'online_store',
    reviewed: null,
    assignedAdminId: null,
    internalNotes: [],
    actuals: null,
    idempotencyKey: key,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function exercise(store: PricingStore, seedAnalysis: (id: string) => Promise<void>) {
  assert.equal(await store.activeVersion(), null);
  const v1 = await store.createVersion({
    version: 1,
    config: DEFAULT_PRICING_CONFIG,
    catalog: DEFAULT_CATALOG,
    note: 'seed',
    createdBy: 'system',
    createdAt: NOW,
  });
  assert.equal(v1?.version, 1);
  assert.equal(
    await store.createVersion({ ...v1!, version: 1 }),
    null,
    'та же версия второй раз не записывается',
  );
  assert.equal(await store.createVersion({ ...v1!, version: 3 }), null, 'через версию нельзя');
  const v2 = await store.createVersion({
    ...v1!,
    version: 2,
    config: { ...DEFAULT_PRICING_CONFIG, billableHourlyRateKzt: 12_000 },
  });
  assert.equal((await store.activeVersion())?.config.billableHourlyRateKzt, 12_000);
  assert.equal((await store.getVersion(1))?.config.billableHourlyRateKzt, 10_000);
  assert.equal(v2?.version, 2);
  assert.deepEqual(
    (await store.listVersions(10)).map((v) => v.version),
    [2, 1],
  );

  await seedAnalysis('a1');
  const g1 = await store.insertEstimates([
    sampleEstimate('e1', 'a1', 1, 'opp:o1'),
    sampleEstimate('e2', 'a1', 1, 'combined'),
  ]);
  assert.deepEqual(g1.map((e) => e.id).sort(), ['e1', 'e2']);
  const again = await store.insertEstimates([sampleEstimate('e3', 'a1', 1, 'opp:o1')]);
  assert.deepEqual(again.map((e) => e.id).sort(), ['e1', 'e2'], 'поколение не дублируется');
  const g2 = await store.insertEstimates([sampleEstimate('e4', 'a1', 2, 'opp:o1')]);
  assert.deepEqual(
    g2.map((e) => e.id),
    ['e4'],
  );
  const e1 = await store.getEstimate('e1');
  assert.equal(e1?.result.priceKzt?.expected, g1[1]!.result.priceKzt?.expected);
  assert.ok((await store.listEstimates(10)).length >= 3);

  const first = await store.createRequest(sampleRequest(e1!, 'u1', 'key-12345678'));
  assert.equal(first.duplicate, false);
  const dup = await store.createRequest({
    ...sampleRequest(e1!, 'u1', 'key-12345678'),
    id: 'other',
  });
  assert.equal(dup.duplicate, true);
  assert.equal(dup.request.id, first.request.id);
  await store.createRequest(sampleRequest(e1!, 'u2', 'key-87654321'));
  assert.equal((await store.listRequests({ userId: 'u1', limit: 10 })).length, 1);
  assert.equal((await store.listRequests({ limit: 10 })).length, 2);
  assert.equal((await store.listRequests({ status: 'new', limit: 10 })).length, 2);

  const updated = await store.updateRequest(
    { ...first.request, status: 'reviewing', updatedAt: NOW },
    first.request.version,
  );
  assert.equal(updated?.status, 'reviewing');
  assert.equal(updated?.version, 2);
  assert.equal(
    await store.updateRequest({ ...first.request, status: 'rejected' }, first.request.version),
    null,
    'устаревшая версия не записывается',
  );
  assert.equal(updated?.snapshot.result.priceKzt?.expected, e1!.result.priceKzt?.expected);

  await store.appendAudit({
    id: 'log1',
    entityType: 'request',
    entityId: first.request.id,
    actorId: 'admin',
    action: 'status',
    previous: { status: 'new' },
    next: { status: 'reviewing' },
    reason: 'взяли в работу',
    createdAt: NOW,
  });
  const log = await store.audit('request', first.request.id);
  assert.equal(log.length, 1);
  assert.deepEqual(log[0]!.previous, { status: 'new' });
}

test('хранилище смет в памяти', async () => {
  await exercise(new MemoryPricingStore(), async () => {});
});

test('хранилище смет в Postgres (миграция 0012)', async (t) => {
  const sql = await openTestSql();
  if (!sql) {
    t.skip('нет PGlite или TEST_DATABASE_URL');
    return;
  }
  try {
    await runMigrations(sql.db, MIGRATIONS, () => {});
    await exercise(new PostgresPricingStore(sql.runner), async (id) => {
      await sql.runner.query(
        `INSERT INTO discovery_analyses (id, user_id, mode, language, status, input_text, budget_day)
         VALUES ($1, 'u1', 'free', 'ru', 'ready', 'текст', '2026-11-07')`,
        [id],
      );
    });
  } finally {
    await sql.close();
  }
});
