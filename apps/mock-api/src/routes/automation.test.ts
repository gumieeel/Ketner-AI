/**
 * Подписка «Автоматизации» через Dodo (этап E): сессия оплаты с пробным месяцем, вебхуки с
 * настоящей проверкой подписи SDK, идемпотентные начисления, портал, требование подписки.
 */

import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import DodoPayments from 'dodopayments';
import { createApp } from '../app.js';
import {
  AUTOMATION_PLAN,
  AutomationSubscriptionService,
  type AutomationSubscription,
  type DodoClientPort,
  type ProcessedWebhook,
} from '../billing/automation-subscription.js';
import { CreditStore } from '../store/credit-store.js';
import { DocStore } from '../store/doc-store.js';
import type { MailMessage } from '../services/mailer.js';
import { createConversationStore } from '../store/conversation-store.js';
import { createSubscriptionStore } from '../store/subscription-store.js';
import { createUserStore } from '../store/user-store.js';
import { UsageStore } from '../store/usage-store.js';
import { isCodeMail, rememberCodeMails, signupAndVerify } from '../testing/signup.js';

const SECRET = randomBytes(24);
const WEBHOOK_KEY = `whsec_${SECRET.toString('base64')}`;
const PRODUCT = 'pdt_automation';

/** Настоящий клиент SDK (проверка подписи), сетевые методы — подделки. */
function dodoClient() {
  const sessions: Array<Record<string, unknown>> = [];
  const client = new DodoPayments({
    bearerToken: 'dodo_test_key',
    environment: 'test_mode',
    webhookKey: WEBHOOK_KEY,
  }) as unknown as DodoClientPort;
  client.checkoutSessions.create = async (params) => {
    sessions.push(params as never);
    return { session_id: 'cks_1', checkout_url: 'https://test.checkout.dodopayments.com/cks_1' };
  };
  client.customers.customerPortal.create = async (customerId) => ({
    link: `https://test.customer.dodopayments.com/${customerId}`,
  });
  return { client, sessions };
}

function signed(body: string, id: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', SECRET)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');
  return {
    'Content-Type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${signature}`,
  };
}

function subscriptionEvent(
  type: string,
  userId: string,
  patch: Record<string, unknown> = {},
): string {
  const created = new Date(Date.now() - 60_000).toISOString();
  return JSON.stringify({
    business_id: 'bus_1',
    type,
    timestamp: new Date().toISOString(),
    data: {
      payload_type: 'Subscription',
      subscription_id: 'sub_1',
      status: 'active',
      product_id: PRODUCT,
      customer: { customer_id: 'cus_1', email: 'sub-owner@example.com', name: 'Анна' },
      metadata: { ketner_user_id: userId },
      trial_period_days: 30,
      created_at: created,
      previous_billing_date: created,
      next_billing_date: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      cancel_at_next_billing_date: false,
      ...patch,
    },
  });
}

async function start() {
  const dir = mkdtempSync(join(tmpdir(), 'ketner-automation-'));
  const mails: MailMessage[] = [];
  const dodo = dodoClient();
  const app = createApp({
    store: createConversationStore(join(dir, 'c.json')),
    userStore: createUserStore(join(dir, 'u.json')),
    subscriptionStore: createSubscriptionStore(join(dir, 's.json')),
    usageStore: new UsageStore(join(dir, 'usage.json')),
    discoveryEnabled: true,
    dodo: { client: dodo.client, productId: PRODUCT, required: true },
    mailer: {
      kind: 'smtp',
      async send(message) {
        if (isCodeMail(message)) mails.push(message);
      },
    },
  });
  const server: Server = app.listen(0);
  const base = `http://localhost:${(server.address() as { port: number }).port}`;
  rememberCodeMails(base, mails);
  return {
    base,
    sessions: dodo.sessions,
    close: () => server.close(),
  };
}

async function signup(base: string, email: string) {
  const response = await signupAndVerify(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', name: 'Анна' }),
  });
  const token = ((await response.json()) as { token: string }).token;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const me = (await (await fetch(`${base}/api/auth/me`, { headers })).json()) as {
    user: { id: string };
  };
  return { headers, userId: me.user.id };
}

test('подписка по HTTP: пробный месяц с картой, вебхуки с подписью, кредиты один раз, портал', async () => {
  const app = await start();
  try {
    const owner = await signup(app.base, 'sub-owner@example.com');
    const info = (await (
      await fetch(`${app.base}/api/billing/automation`, { headers: owner.headers })
    ).json()) as { available: boolean; plan: typeof AUTOMATION_PLAN; subscription: unknown };
    assert.equal(info.available, true);
    assert.equal(info.plan.priceUsd, 15);
    assert.equal(info.subscription, null);
    assert.equal((await fetch(`${app.base}/api/billing/automation`)).status, 401);

    // Без подписки «Приступить к автоматизации» не создаёт черновик — нужна подписка.
    const gated = await fetch(`${app.base}/api/solutions/from-opportunity`, {
      method: 'POST',
      headers: owner.headers,
      body: JSON.stringify({ analysisId: 'a1', opportunityId: 'o1', confirm: true }),
    });
    assert.equal(gated.status, 402);
    assert.equal(
      ((await gated.json()) as { error: { code: string } }).error.code,
      'subscription_required',
    );

    const checkout = await fetch(`${app.base}/api/billing/automation/checkout`, {
      method: 'POST',
      headers: owner.headers,
      body: JSON.stringify({ returnPath: '/analyses/a1' }),
    });
    assert.equal(checkout.status, 200);
    assert.match(((await checkout.json()) as { url: string }).url, /checkout\.dodopayments/);
    const { return_url: returnUrl, ...session } = app.sessions[0]!;
    assert.deepEqual(session, {
      product_cart: [{ product_id: PRODUCT, quantity: 1 }],
      customer: { email: 'sub-owner@example.com', name: 'Анна' },
      subscription_data: { trial_period_days: 30 },
      metadata: { ketner_user_id: owner.userId },
    });
    assert.match(String(returnUrl), /^https?:\/\/[^/]+\/analyses\/a1$/);

    // Поддельная подпись — 401, ничего не начислено.
    const forged = subscriptionEvent('subscription.active', owner.userId);
    const bad = await fetch(`${app.base}/api/webhooks/dodo`, {
      method: 'POST',
      headers: { ...signed(forged, 'msg_forged'), 'webhook-signature': 'v1,AAAA' },
      body: forged,
    });
    assert.equal(bad.status, 401);

    // Пробный месяц начался: 2 000 кредитов; повтор вебхука и повтор события — без удвоения.
    const active = subscriptionEvent('subscription.active', owner.userId);
    for (const id of ['msg_1', 'msg_1', 'msg_2']) {
      const response = await fetch(`${app.base}/api/webhooks/dodo`, {
        method: 'POST',
        headers: signed(active, id),
        body: active,
      });
      assert.equal(response.status, 200);
    }
    const credits = async () =>
      (
        (await (
          await fetch(`${app.base}/api/usage/credits`, { headers: owner.headers })
        ).json()) as {
          grants: Array<{ id: string; amount: number }>;
        }
      ).grants.filter((grant) => grant.id.startsWith('dodo:'));
    assert.deepEqual(
      (await credits()).map((grant) => [grant.id, grant.amount]),
      [['dodo:sub_1:trial', 2000]],
    );
    const status = (await (
      await fetch(`${app.base}/api/billing/automation`, { headers: owner.headers })
    ).json()) as { subscription: { status: string; trialEndsAt: string | null } };
    assert.equal(status.subscription.status, 'active');
    assert.ok(status.subscription.trialEndsAt);

    // Подписка действует — повторная оплата не нужна, автоматизация не упирается в 402.
    const again = await fetch(`${app.base}/api/billing/automation/checkout`, {
      method: 'POST',
      headers: owner.headers,
      body: '{}',
    });
    assert.equal(again.status, 409);
    const notGated = await fetch(`${app.base}/api/solutions/from-opportunity`, {
      method: 'POST',
      headers: owner.headers,
      body: JSON.stringify({ analysisId: 'a1', opportunityId: 'o1', confirm: true }),
    });
    assert.notEqual(notGated.status, 402);

    const portal = await fetch(`${app.base}/api/billing/automation/portal`, {
      method: 'POST',
      headers: owner.headers,
    });
    assert.deepEqual(await portal.json(), {
      url: 'https://test.customer.dodopayments.com/cus_1',
    });
  } finally {
    app.close();
  }
});

test('продление начисляет 7 500 кредитов за период один раз; отмена и сбой оплаты меняют статус', () => {
  const credits = new CreditStore();
  const subscriptions = new DocStore<AutomationSubscription>('automation_subscriptions');
  const now = Date.parse('2026-12-01T10:00:00.000Z');
  const service = new AutomationSubscriptionService({
    client: dodoClient().client,
    productId: PRODUCT,
    credits,
    subscriptions,
    webhooks: new DocStore<ProcessedWebhook>('dodo_webhooks'),
    users: {
      findById: (id) => (id === 'u1' ? ({ id, email: 'u1@example.com' } as never) : null),
      findByEmail: () => null,
    },
    siteUrl: 'https://ketner.org',
    now: () => now,
  });
  const base = {
    subscription_id: 'sub_9',
    status: 'active',
    product_id: PRODUCT,
    customer: { customer_id: 'cus_9' },
    metadata: { ketner_user_id: 'u1' },
    trial_period_days: 30,
    created_at: '2026-10-30T10:00:00.000Z',
    previous_billing_date: '2026-11-29T10:00:00.000Z',
    next_billing_date: '2026-12-29T10:00:00.000Z',
  };
  service.apply('subscription.renewed', base);
  service.apply('subscription.renewed', base);
  const grants = credits.allOf('u1').filter((grant) => grant.id.startsWith('dodo:'));
  assert.deepEqual(
    grants.map((grant) => [grant.id, Math.round(grant.amountUsd * 1000)]),
    [['dodo:sub_9:2026-11-29T10:00:00.000Z', AUTOMATION_PLAN.monthlyCredits]],
  );
  assert.equal(subscriptions.get('u1')?.trialEndsAt, null, 'пробный месяц уже прошёл');

  service.apply('subscription.on_hold', { ...base, status: 'on_hold' });
  assert.equal(subscriptions.get('u1')?.status, 'on_hold');
  service.apply('subscription.cancelled', {
    ...base,
    status: 'cancelled',
    cancel_at_next_billing_date: true,
  });
  assert.equal(subscriptions.get('u1')?.status, 'cancelled');
  assert.equal(subscriptions.get('u1')?.cancelAtPeriodEnd, true);
  // Чужой продукт игнорируется.
  service.apply('subscription.active', { ...base, product_id: 'pdt_other', subscription_id: 'x' });
  assert.equal(subscriptions.get('u1')?.subscriptionId, 'sub_9');
});

test('напоминание за 3 дня до конца пробного месяца — один раз', async () => {
  const mails: MailMessage[] = [];
  const subscriptions = new DocStore<AutomationSubscription>('automation_subscriptions');
  let now = Date.parse('2026-11-01T10:00:00.000Z');
  const service = new AutomationSubscriptionService({
    client: dodoClient().client,
    productId: PRODUCT,
    credits: new CreditStore(),
    subscriptions,
    webhooks: new DocStore<ProcessedWebhook>('dodo_webhooks'),
    users: {
      findById: (id) => ({ id, email: `${id}@example.com`, name: 'Анна' }) as never,
      findByEmail: () => null,
    },
    mailer: {
      kind: 'smtp',
      async send(message) {
        mails.push(message);
      },
    },
    siteUrl: 'https://ketner.org',
    now: () => now,
  });
  subscriptions.put({
    id: 'u1',
    subscriptionId: 'sub_1',
    customerId: 'cus_1',
    status: 'active',
    trialEndsAt: '2026-11-30T10:00:00.000Z',
    nextBillingDate: '2026-11-30T10:00:00.000Z',
    cancelAtPeriodEnd: false,
    trialReminderSentAt: null,
    updatedAt: '2026-11-01T10:00:00.000Z',
  });
  assert.equal(await service.sendTrialReminders(), 0, 'рано');
  now = Date.parse('2026-11-28T10:00:00.000Z');
  assert.equal(await service.sendTrialReminders(), 1);
  assert.equal(await service.sendTrialReminders(), 0, 'второй раз не пишем');
  assert.match(mails[0]?.text ?? '', /спишется \$15/);
  assert.match(mails[0]?.text ?? '', /Управлять подпиской/);
});
