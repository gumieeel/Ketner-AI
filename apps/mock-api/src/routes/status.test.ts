import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createStatusRouter, overallState, type StatusDeps, type StatusReport } from './status.js';

async function getStatus(deps: StatusDeps, times = 1): Promise<StatusReport[]> {
  const app = express();
  app.use('/api', createStatusRouter(deps));
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const reports: StatusReport[] = [];
    for (let i = 0; i < times; i += 1) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/status`);
      assert.equal(response.status, 200);
      reports.push((await response.json()) as StatusReport);
    }
    return reports;
  } finally {
    server.close();
  }
}

const healthy: StatusDeps = {
  checkDatabase: async () => true,
  checkModels: async () => 'ok',
  breaker: { getAllStatuses: () => [] },
  features: { images: true, crypto: true, telegram: true },
};

const stateOf = (report: StatusReport, id: string) =>
  report.components.find((component) => component.id === id)?.state;

test('статус: всё работает', async () => {
  const [report] = await getStatus(healthy);
  assert.equal(report.state, 'operational');
  assert.deepEqual(
    report.components.map((c) => c.id),
    ['site', 'database', 'models', 'images', 'payments', 'telegram'],
  );
  assert.ok(report.components.every((c) => c.state === 'operational'));
});

test('статус: база не отвечает — сбой', async () => {
  const [report] = await getStatus({ ...healthy, checkDatabase: async () => false });
  assert.equal(stateOf(report, 'database'), 'outage');
  assert.equal(report.state, 'outage');
});

test('статус: ключ поставщика моделей отклонён — модели и картинки не работают', async () => {
  const [report] = await getStatus({ ...healthy, checkModels: async () => 'rejected' });
  assert.equal(stateOf(report, 'models'), 'outage');
  assert.equal(stateOf(report, 'images'), 'degraded');
  assert.equal(report.state, 'outage');
});

test('статус: открытый предохранитель модели — частичные проблемы, без подробностей', async () => {
  const [report] = await getStatus({
    ...healthy,
    breaker: {
      getAllStatuses: () => [
        {
          provider: 'openrouter:anthropic/claude-opus-5.5',
          state: 'open',
          consecutiveFailures: 3,
          lastFailureTime: 1,
          cooldownRemainingMs: 1000,
        },
      ],
    },
  });
  assert.equal(stateOf(report, 'models'), 'degraded');
  assert.equal(report.state, 'degraded');
  // Наружу не уходит ни идентификатор модели, ни текст ошибки.
  assert.ok(!JSON.stringify(report).includes('anthropic'));
});

test('статус: отключённые разделы не портят общее состояние', async () => {
  const [report] = await getStatus({
    ...healthy,
    features: { images: false, crypto: false, telegram: false },
  });
  assert.equal(stateOf(report, 'images'), 'unavailable');
  assert.equal(report.state, 'operational');
});

test('статус: проверки кэшируются', async () => {
  let calls = 0;
  await getStatus(
    {
      ...healthy,
      checkDatabase: async () => {
        calls += 1;
        return true;
      },
    },
    3,
  );
  assert.equal(calls, 1);
});

test('overallState: худший из основных компонентов', () => {
  assert.equal(
    overallState([
      { id: 'site', state: 'operational' },
      { id: 'telegram', state: 'outage' },
    ]),
    'operational',
  );
  assert.equal(
    overallState([
      { id: 'site', state: 'operational' },
      { id: 'models', state: 'degraded' },
    ]),
    'degraded',
  );
});
