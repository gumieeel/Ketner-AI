import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountTiers, type AccountTier } from '../billing/account-tiers.js';
import { config } from '../config.js';
import { DocStore } from '../store/doc-store.js';
import { readJson, startTestServer } from '../testing/server.js';
import { signupAndVerify } from '../testing/signup.js';
import type { AuthSession } from '../types.js';
import { getDiscoveryStores } from '../discovery/runtime.js';
import { defaultConfig } from '../builder/service.js';
import type { Solution } from '../builder/types.js';

const admin = { 'x-admin-key': config.adminApiKey, 'Content-Type': 'application/json' };

async function harness() {
  const store = new DocStore<AccountTier>('account_tiers');
  const server = await startTestServer({}, { accountTiers: new AccountTiers(store) });
  const session = await readJson<AuthSession>(
    await signupAndVerify(server.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `tier-${Date.now()}@example.com`,
        password: 'password123',
        name: 'Owner',
      }),
    }),
  );
  return { server, store, userId: session.user.id, token: session.token };
}

type TierCard = {
  tier: string | null;
  used: number;
  limit: number | null;
  state: string;
  action: string;
  enforced: boolean;
  wouldLimit: number;
  setBy: string | null;
  note: string | null;
};

test('администратор назначает и снимает тариф; карточка и сводка показывают «как было бы»', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const url = `${h.server.baseUrl}/api/admin/users/${h.userId}/tier`;

  const empty = await readJson<{ tier: TierCard }>(await fetch(url, { headers: admin }));
  assert.equal(empty.tier.tier, null);
  assert.equal(empty.tier.state, 'no_tier');
  assert.equal(empty.tier.action, 'form_only');
  assert.equal(empty.tier.enforced, false, 'P3 выходит с TIER_ENFORCED = false');

  const bad = await fetch(url, { method: 'PUT', headers: admin, body: '{"tier":"pro"}' });
  assert.equal(bad.status, 400);

  const set = await fetch(url, {
    method: 'PUT',
    headers: admin,
    body: JSON.stringify({ tier: 'growth', note: 'собственный аккаунт' }),
  });
  assert.equal(set.status, 200);
  const card = (await readJson<{ tier: TierCard }>(set)).tier;
  assert.equal(card.tier, 'growth');
  assert.equal(card.limit, 5_500);
  assert.equal(card.action, 'answer');
  assert.equal(card.wouldLimit, 0);
  assert.equal(card.setBy, 'admin_key');
  assert.equal(card.note, 'собственный аккаунт');
  assert.equal(h.store.get(h.userId)?.tier, 'growth');

  // Карточка пользователя в администрировании — тот же блок.
  const user = await readJson<{ tier: TierCard }>(
    await fetch(`${h.server.baseUrl}/api/admin/users/${h.userId}`, { headers: admin }),
  );
  assert.equal(user.tier.tier, 'growth');

  const list = await readJson<{
    enforced: boolean;
    accounts: Array<{ userId: string; tier: string }>;
  }>(await fetch(`${h.server.baseUrl}/api/admin/tiers`, { headers: admin }));
  assert.equal(list.enforced, false);
  assert.deepEqual(
    list.accounts.filter((row) => row.userId === h.userId).map((row) => row.tier),
    ['growth'],
  );

  const removed = await fetch(url, { method: 'DELETE', headers: admin });
  assert.equal(removed.status, 200);
  assert.equal((await readJson<{ tier: TierCard }>(removed)).tier.tier, null);
});

test('тариф не записался в базу — 503, прежний тариф остался', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const url = `${h.server.baseUrl}/api/admin/users/${h.userId}/tier`;
  await fetch(url, { method: 'PUT', headers: admin, body: '{"tier":"start"}' });
  h.store.setDbDriver({
    upsert: async () => {
      throw new Error('database down');
    },
    remove: async () => {
      throw new Error('database down');
    },
  });
  const original = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = original;
  });
  const failed = await fetch(url, { method: 'PUT', headers: admin, body: '{"tier":"scale"}' });
  assert.equal(failed.status, 503);
  assert.equal(h.store.get(h.userId)?.tier, 'start');
  const notRemoved = await fetch(url, { method: 'DELETE', headers: admin });
  assert.equal(notRemoved.status, 503);
  assert.equal(h.store.get(h.userId)?.tier, 'start');
});

test('тарифы — только администратору', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  for (const [method, path] of [
    ['GET', '/api/admin/tiers'],
    ['PUT', `/api/admin/users/${h.userId}/tier`],
    ['DELETE', `/api/admin/users/${h.userId}/tier`],
  ] as const) {
    const response = await fetch(`${h.server.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${h.token}`, 'Content-Type': 'application/json' },
      body: method === 'PUT' ? '{"tier":"scale"}' : undefined,
    });
    assert.ok([401, 403].includes(response.status), `${method} ${path}: ${response.status}`);
  }
  assert.equal(h.store.get(h.userId), undefined, 'обычный пользователь себе тариф не назначит');
});

test('бюджет бесплатного создания за сутки: администратору — текущее значение, остальным — нет', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  const url = `${h.server.baseUrl}/api/admin/free-build-budget`;
  const body = await readJson<{
    budget: { day: string; spentUsd: number; limitUsd: number; share: number; resetsAt: string };
  }>(await fetch(url, { headers: admin }));
  assert.equal(body.budget.limitUsd, 3);
  assert.equal(body.budget.day, new Date().toISOString().slice(0, 10));
  assert.ok(body.budget.spentUsd >= 0 && body.budget.share >= 0);
  assert.ok(Date.parse(body.budget.resetsAt) > Date.now());
  const user = await fetch(url, { headers: { Authorization: `Bearer ${h.token}` } });
  assert.ok([401, 403].includes(user.status));
});

/** Опубликованный бот аккаунта в хранилище платформы (в тестах — общее хранилище в памяти). */
async function publishBot(ownerId: string, id: string, slug: string, status: Solution['status']) {
  const at = new Date().toISOString();
  await getDiscoveryStores()!.builder.createSolution(
    {
      id,
      ownerId,
      type: 'customer_bot',
      template: 'customer_bot',
      status,
      name: `Бот ${slug}`,
      currentVersion: 1,
      activeVersion: status === 'draft' ? null : 1,
      source: null,
      version: 1,
      createdAt: at,
      updatedAt: at,
      bot: { slug, greeting: '', quickReplies: [], dailyCapCredits: 1000, corrections: [] },
    } as Solution,
    { solutionId: id, number: 1, config: defaultConfig('Бот', 'ru'), createdAt: at },
    [],
  );
}

test('сводка тарифов: опубликованные боты без тарифа видны до включения (?withoutTier=1)', async (t) => {
  const h = await harness();
  t.after(() => h.server.close());
  await publishBot(h.userId, `bot-live-${Date.now()}`, `live-${Date.now()}`, 'active');
  await publishBot(h.userId, `bot-draft-${Date.now()}`, `draft-${Date.now()}`, 'draft');
  type Row = {
    userId: string;
    tier: string | null;
    email: string | null;
    publishedBots: unknown[];
  };
  const read = async (query = '') =>
    (
      await readJson<{ accounts: Row[] }>(
        await fetch(`${h.server.baseUrl}/api/admin/tiers${query}`, { headers: admin }),
      )
    ).accounts.filter((row) => row.userId === h.userId);

  // Без обращений в этом месяце и без тарифа аккаунт всё равно в сводке: у него опубликованный бот.
  const [row] = await read();
  assert.equal(row?.tier, null);
  assert.equal(row?.publishedBots.length, 1, 'черновик не считается');
  assert.match(row?.email ?? '', /@example\.com$/);
  assert.equal((await read('?withoutTier=1')).length, 1);

  // Тариф назначен — в списке «без тарифа» аккаунта нет.
  await fetch(`${h.server.baseUrl}/api/admin/users/${h.userId}/tier`, {
    method: 'PUT',
    headers: admin,
    body: JSON.stringify({ tier: 'start' }),
  });
  assert.equal((await read('?withoutTier=1')).length, 0);
  assert.equal((await read())[0]?.tier, 'start');
});
