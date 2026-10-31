import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryBudgetStore } from '../discovery/budget.js';
import { DiscoveryService } from '../discovery/service.js';
import { MemoryDiscoveryStore } from '../discovery/store.js';
import { BENCH_TASKS, dryGateway, runTask, summarize } from './benchmark-discovery.js';

test('замер качества: 20 задач на русском, половина с числами; прогон на шаблонах считает метрики', async () => {
  assert.equal(BENCH_TASKS.length, 20);
  assert.equal(new Set(BENCH_TASKS.map((task) => task.id)).size, 20);
  assert.ok(BENCH_TASKS.filter((task) => task.numbers).length >= 8);

  const service = new DiscoveryService({
    store: new MemoryDiscoveryStore(),
    budget: new MemoryBudgetStore(),
    gateway: dryGateway,
    balanceUsd: () => 1000,
    userCapabilities: () => ({ hasPurchasedCredits: true, githubConnected: false }),
    freeDailyUsd: 1000,
    budgetTimeZone: 'UTC',
  });
  const results = [
    await runTask(service, BENCH_TASKS[0]!, 'free', 0),
    await runTask(service, BENCH_TASKS[2]!, 'paid', 1),
  ];
  await service.whenIdle();
  for (const result of results) {
    assert.equal(result.status, 'ready', result.error ?? '');
    assert.deepEqual(result.stages.context, { attempts: 1, ok: true });
    assert.ok(result.opportunities >= 3);
    assert.ok(result.planSteps > 0);
  }
  const summary = summarize(results);
  assert.equal(summary.reports, '2/2 (100%)');
  assert.equal(summary.validJsonFirstTry.discovery, '2/2 (100%)');
  // Шаблоны чисел не содержат: задача без чисел честна, задача с числами — нет.
  assert.equal(summary.numbersHonest, '1/2 (50%)');
});
