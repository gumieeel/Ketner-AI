import { TRIAL_CREDITS } from '../services/entitlement.js';
import { signupAndVerify } from '../testing/signup.js';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { config } from '../config.js';
import { readJson, startTestServer } from '../testing/server.js';
import type { AuthSession } from '../types.js';

/** Подписывает тело так же, как это делает платёжный провайдер: HMAC-SHA256 по сырым байтам. */
function signedWebhook(body: unknown, secret: string = config.webhookSecret) {
  const raw = JSON.stringify(body);
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-signature': createHmac('sha256', secret).update(raw).digest('hex'),
    },
    body: raw,
  };
}

async function signup(baseUrl: string, email: string): Promise<{ token: string; id: string }> {
  const res = await signupAndVerify(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', name: 'Webhook User' }),
  });
  const body = await readJson<AuthSession>(res);
  return { token: body.token, id: body.user.id };
}

async function currentSubscription(baseUrl: string, token: string) {
  const res = await fetch(`${baseUrl}/api/billing/subscription`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return ((await res.json()) as { subscription: { plan: string; status: string } }).subscription;
}

test('webhooks: активация подписки, отмена и идемпотентность (с подписью)', async () => {
  const server = await startTestServer();

  try {
    const user = await signup(server.baseUrl, 'webhook-user@example.com');
    const eventId = `evt_test_${Date.now()}`;
    const paid = {
      id: eventId,
      type: 'invoice.paid',
      data: { userId: user.id, planId: 'gpt-pro' },
    };

    // 1. invoice.paid -> план gpt-pro
    const payRes = await fetch(`${server.baseUrl}/api/webhooks`, signedWebhook(paid));
    assert.equal(payRes.status, 200);
    const payBody = (await payRes.json()) as { received: boolean; status?: string };
    assert.equal(payBody.received, true);
    assert.equal(payBody.status, 'processed');

    const active = await currentSubscription(server.baseUrl, user.token);
    assert.equal(active.plan, 'gpt-pro');
    assert.equal(active.status, 'active');

    // 2. Идемпотентность: то же событие повторно
    const replayRes = await fetch(`${server.baseUrl}/api/webhooks`, signedWebhook(paid));
    assert.equal(replayRes.status, 200);
    const replayBody = (await replayRes.json()) as {
      received: boolean;
      idempotentReplay?: boolean;
    };
    assert.equal(replayBody.idempotentReplay, true);

    // 3. Отмена подписки
    const cancelRes = await fetch(
      `${server.baseUrl}/api/webhooks`,
      signedWebhook({
        id: `evt_cancel_${Date.now()}`,
        type: 'subscription.deleted',
        data: { userId: user.id },
      }),
    );
    assert.equal(cancelRes.status, 200);

    const canceled = await currentSubscription(server.baseUrl, user.token);
    assert.equal(canceled.plan, 'free');
    assert.equal(canceled.status, 'canceled');
  } finally {
    await server.close();
  }
});

test('webhooks (C6): запрос без подписи, с чужой подписью или с изменённым телом отклоняется', async () => {
  const server = await startTestServer();

  try {
    const user = await signup(server.baseUrl, 'webhook-victim@example.com');
    const event = {
      id: `evt_forged_${Date.now()}`,
      type: 'invoice.paid',
      data: { userId: user.id, planId: 'ultra' },
    };
    const raw = JSON.stringify(event);

    // Без подписи
    const unsigned = await fetch(`${server.baseUrl}/api/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw,
    });
    assert.equal(unsigned.status, 401);

    // Заведомо неверный секрет и «тестовая» подпись
    const wrongSecret = await fetch(
      `${server.baseUrl}/api/webhooks`,
      signedWebhook(event, 'definitely-wrong-secret-1234567890'),
    );
    assert.equal(wrongSecret.status, 401);
    const testSignature = await fetch(`${server.baseUrl}/api/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-signature': 'test-signature' },
      body: raw,
    });
    assert.equal(testSignature.status, 401);

    // Подпись от одного тела, отправлено другое
    const valid = signedWebhook(event);
    const tampered = await fetch(`${server.baseUrl}/api/webhooks`, {
      ...valid,
      body: JSON.stringify({ ...event, data: { userId: user.id, planId: 'pro' } }),
    });
    assert.equal(tampered.status, 401);

    const sub = await currentSubscription(server.baseUrl, user.token);
    assert.equal(sub.plan, 'free');
  } finally {
    await server.close();
  }
});

test('cryptocloud postback (C6): без валидного токена кредиты пакета не выдаются', async () => {
  const server = await startTestServer();

  try {
    const user = await signup(server.baseUrl, 'cc-victim@example.com');
    const auth = { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' };

    const created = await fetch(`${server.baseUrl}/api/billing/crypto/create-invoice`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ packId: 'credits-5', currency: 'USDT_TRC20' }),
    });
    const { invoice } = await readJson<{ invoice: { id: string } }>(created);

    for (const token of [undefined, 'garbage', 'a.b.c', config.adminApiKey]) {
      const res = await fetch(`${server.baseUrl}/api/billing/cryptocloud/postback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'success',
          order_id: invoice.id,
          invoice_id: invoice.id,
          token,
        }),
      });
      assert.equal(res.status, 401);
    }

    const sub = await currentSubscription(server.baseUrl, user.token);
    assert.equal(sub.plan, 'free');
    const report = await readJson<{ purchased: boolean; granted: number }>(
      await fetch(`${server.baseUrl}/api/usage/credits`, { headers: auth }),
    );
    assert.equal(report.purchased, false, 'купленных кредитов нет');
    assert.equal(report.granted, TRIAL_CREDITS, 'только пробные');
  } finally {
    await server.close();
  }
});
