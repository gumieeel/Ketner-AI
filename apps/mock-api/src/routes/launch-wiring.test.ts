import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountTiers, type AccountTier } from '../billing/account-tiers.js';
import { setTierEnforcedForTests } from '../billing/tier-usage.js';
import { defaultConfig } from '../builder/service.js';
import type { Solution } from '../builder/types.js';
import { getDiscoveryStores } from '../discovery/runtime.js';
import { DocStore } from '../store/doc-store.js';
import { readJson, startTestServer } from '../testing/server.js';
import { signupAndVerify } from '../testing/signup.js';
import type { AuthSession } from '../types.js';

/**
 * Запуск ИИ-агента для клиентов (docs/BUILDER_V1.md, раздел 8) на сервере, собранном как в
 * production: тариф аккаунта доходит до проверки запуска (`GET …/launch`, `POST …/activate`).
 */

setTierEnforcedForTests(true);

interface LaunchView {
  readiness: { ready: boolean; reason?: string };
  tier: { enforced: boolean; id: string | null; active: number; limit: number | null };
  blocked: { code: string } | null;
  canLaunch: boolean;
}

test('шаг 4: тариф аккаунта виден проверке запуска; чужой агент — 404', async (t) => {
  const tiers = new AccountTiers(new DocStore<AccountTier>('account_tiers_launch_test'));
  const server = await startTestServer({}, { accountTiers: tiers });
  t.after(() => server.close());
  const email = `launch-${Date.now()}@example.com`;
  const owner = await readJson<AuthSession>(
    await signupAndVerify(server.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123', name: 'Owner' }),
    }),
  );
  const now = new Date().toISOString();
  const id = `bot-launch-${Date.now()}`;
  await getDiscoveryStores()!.builder.createSolution(
    {
      id,
      ownerId: owner.user.id,
      type: 'customer_bot',
      template: 'customer_bot',
      bot: { slug: id, greeting: '', quickReplies: [], dailyCapCredits: 1000, corrections: [] },
      status: 'draft',
      name: 'Лиса',
      currentVersion: 1,
      activeVersion: null,
      source: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    } as Solution,
    { solutionId: id, number: 1, config: defaultConfig('Лиса', 'ru'), createdAt: now },
    [],
  );
  const headers = { Authorization: `Bearer ${owner.token}` };
  const url = `${server.baseUrl}/api/solutions/${id}/launch`;

  const before = await readJson<LaunchView>(await fetch(url, { headers }));
  assert.equal(before.readiness.ready, false, 'без тест-кейсов не готов');
  assert.deepEqual(before.tier, { enforced: true, id: null, name: null, active: 0, limit: null });
  assert.equal(before.blocked?.code, 'tier_required');
  assert.equal(before.canLaunch, false);

  await tiers.set(owner.user.id, 'start', 'admin@example.com');
  const after = await readJson<LaunchView>(await fetch(url, { headers }));
  assert.deepEqual(after.tier, {
    enforced: true,
    id: 'start',
    name: 'Start',
    active: 0,
    limit: 1,
  });
  assert.equal(after.blocked, null);
  assert.equal(after.canLaunch, false, 'тариф есть, но тесты не пройдены');

  const strangerEmail = `launch-other-${Date.now()}@example.com`;
  const stranger = await readJson<AuthSession>(
    await signupAndVerify(server.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: strangerEmail, password: 'password123', name: 'Other' }),
    }),
  );
  const denied = await fetch(url, { headers: { Authorization: `Bearer ${stranger.token}` } });
  assert.equal(denied.status, 404);
});
