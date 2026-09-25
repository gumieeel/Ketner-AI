import assert from 'node:assert/strict';
import test from 'node:test';
import { startTestServer } from '../testing/server.js';

test('webhooks: активация подписки, отмена и идемпотентность', async () => {
  const server = await startTestServer();

  try {
    const eventId = `evt_test_${Date.now()}`;

    // 1. Событие invoice.paid -> обновление плана на gpt-pro
    const payRes = await fetch(`${server.baseUrl}/api/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: eventId,
        type: 'invoice.paid',
        data: {
          userId: 'demo-user',
          planId: 'gpt-pro',
        },
      }),
    });

    assert.equal(payRes.status, 200);
    const payBody = (await payRes.json()) as { received: boolean; status?: string };
    assert.equal(payBody.received, true);
    assert.equal(payBody.status, 'processed');

    // Проверяем, что подписка действительно активировалась
    const subRes = await fetch(`${server.baseUrl}/api/billing/subscription`, {
      headers: { 'x-user-id': 'demo-user' },
    });
    assert.equal(subRes.status, 200);
    const subBody = (await subRes.json()) as { subscription: { plan: string; status: string } };
    assert.equal(subBody.subscription.plan, 'gpt-pro');
    assert.equal(subBody.subscription.status, 'active');

    // 2. Идемпотентность: повторная отправка того же события
    const replayRes = await fetch(`${server.baseUrl}/api/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: eventId,
        type: 'invoice.paid',
        data: {
          userId: 'demo-user',
          planId: 'gpt-pro',
        },
      }),
    });

    assert.equal(replayRes.status, 200);
    const replayBody = (await replayRes.json()) as { received: boolean; idempotentReplay?: boolean };
    assert.equal(replayBody.received, true);
    assert.equal(replayBody.idempotentReplay, true);

    // 3. Отмена подписки (subscription.deleted)
    const cancelRes = await fetch(`${server.baseUrl}/api/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `evt_cancel_${Date.now()}`,
        type: 'subscription.deleted',
        data: {
          userId: 'demo-user',
        },
      }),
    });
    assert.equal(cancelRes.status, 200);

    const subCanceled = await fetch(`${server.baseUrl}/api/billing/subscription`, {
      headers: { 'x-user-id': 'demo-user' },
    });
    const subCanceledBody = (await subCanceled.json()) as { subscription: { plan: string; status: string } };
    assert.equal(subCanceledBody.subscription.plan, 'free');
    assert.equal(subCanceledBody.subscription.status, 'canceled');
  } finally {
    await server.close();
  }
});
