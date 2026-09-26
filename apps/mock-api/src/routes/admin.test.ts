import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../config.js';
import { startTestServer } from '../testing/server.js';

test('admin: проверка доступа по API ключу', async () => {
  const server = await startTestServer();

  try {
    // 1. Без ключа -> 403
    const denied = await fetch(`${server.baseUrl}/api/admin/models`);
    assert.equal(denied.status, 403);
    const deniedBody = (await denied.json()) as { error: { code: string } };
    assert.equal(deniedBody.error.code, 'admin_access_denied');

    // 2. С валидным ключом -> 200
    const allowed = await fetch(`${server.baseUrl}/api/admin/models`, {
      headers: {
        'x-admin-key': config.adminApiKey,
      },
    });
    assert.equal(allowed.status, 200);
    const modelsBody = (await allowed.json()) as { models: Array<{ id: string; name: string }> };
    assert.ok(Array.isArray(modelsBody.models));
    assert.ok(modelsBody.models.some((m) => m.id === 'gpt-6-astra'));
  } finally {
    await server.close();
  }
});

test('admin: обновление модели (PATCH /api/admin/models/:id)', async () => {
  const server = await startTestServer();

  try {
    const updateRes = await fetch(`${server.baseUrl}/api/admin/models/gpt-6-astra`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': config.adminApiKey,
      },
      body: JSON.stringify({
        enabled: true,
        pricing: {
          inputPricePerMillion: 3.0,
          outputPricePerMillion: 12.0,
          cachedInputPricePerMillion: 1.5,
          effectiveFrom: new Date().toISOString(),
          effectiveTo: null,
        },
      }),
    });

    assert.equal(updateRes.status, 200);
    const updated = (await updateRes.json()) as {
      success: boolean;
      model: { pricing: { inputPricePerMillion: number } };
    };
    assert.equal(updated.success, true);
    assert.equal(updated.model.pricing.inputPricePerMillion, 3.0);
  } finally {
    await server.close();
  }
});

test('admin: метрики провайдеров, статистика и рентабельность', async () => {
  const server = await startTestServer();

  try {
    const headers = { 'x-admin-key': config.adminApiKey };

    // Providers
    const provRes = await fetch(`${server.baseUrl}/api/admin/providers`, { headers });
    assert.equal(provRes.status, 200);
    const provBody = (await provRes.json()) as { providers: Array<{ provider: string }> };
    assert.ok(Array.isArray(provBody.providers));
    assert.ok(provBody.providers.some((p) => p.provider === 'openai'));

    // Global Usage
    const usageRes = await fetch(`${server.baseUrl}/api/admin/usage`, { headers });
    assert.equal(usageRes.status, 200);
    const usageBody = (await usageRes.json()) as { stats: { totalRequests: number } };
    assert.ok(typeof usageBody.stats.totalRequests === 'number');

    // Profitability with manual override
    const profRes = await fetch(`${server.baseUrl}/api/admin/profitability/demo-user?planPrice=39.99`, {
      headers,
    });
    assert.equal(profRes.status, 200);
    const profBody = (await profRes.json()) as {
      profitability: { userId: string; subscriptionRevenue: number; status: string; plan: string };
    };
    assert.equal(profBody.profitability.userId, 'demo-user');
    assert.equal(profBody.profitability.subscriptionRevenue, 39.99);
    assert.ok(profBody.profitability.status);

    // Profitability with automatic resolution (demo-user is free -> $0)
    const autoProfRes = await fetch(`${server.baseUrl}/api/admin/profitability/demo-user`, {
      headers,
    });
    assert.equal(autoProfRes.status, 200);
    const autoProfBody = (await autoProfRes.json()) as {
      profitability: { userId: string; subscriptionRevenue: number; plan: string; priceRub: number };
    };
    assert.equal(autoProfBody.profitability.userId, 'demo-user');
    assert.equal(autoProfBody.profitability.plan, 'free');
    assert.equal(autoProfBody.profitability.priceRub, 0);
    assert.equal(autoProfBody.profitability.subscriptionRevenue, 0);
  } finally {
    await server.close();
  }
});
