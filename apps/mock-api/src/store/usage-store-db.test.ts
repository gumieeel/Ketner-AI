import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { UsageStore } from './usage-store.js';

const base = {
  userId: 'u1',
  conversationId: 'c1',
  modelId: 'm',
  provider: 'mock' as never,
  inputTokens: 1,
  outputTokens: 1,
  estimatedCost: 0.01,
  latencyMs: 5,
  status: 'success' as const,
};

test('UsageStore: записи зеркалируются в базу и поднимаются оттуда после перезапуска', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'usage-'));
  const saved: unknown[] = [];
  const first = new UsageStore(join(dir, 'a.json'));
  first.setDbDriver({ upsert: async (_ns, doc) => void saved.push(doc) });
  const record = first.recordUsage(base);
  assert.equal(saved.length, 1);
  assert.equal((saved[0] as { id: string }).id, record.id);

  // «Новый сервер»: диск пуст, данные приходят из базы; повторная загрузка не дублирует записи
  const second = new UsageStore(join(dir, 'b.json'));
  second.loadExternal(saved as never);
  second.loadExternal(saved as never);
  second.setDbDriver(null);
  const again = second.recordUsage({ ...base, userId: 'u1' });
  assert.notEqual(again.id, record.id);
  assert.equal(second.namespace, 'usage');
});
