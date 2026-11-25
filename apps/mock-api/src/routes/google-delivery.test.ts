import assert from 'node:assert/strict';
import test from 'node:test';
import type { BotLead, Solution } from '../builder/types.js';
import { getDiscoveryStores } from '../discovery/runtime.js';
import { createGoogleConnectionStore } from '../google/connection-store.js';
import { createSheetsDelivery } from '../google/delivery-runtime.js';
import { setProductSwitchForTests } from '../product-switches.js';
import { FAKE_GOOGLE_SETTINGS, createFakeGoogle } from '../testing/fake-google.js';
import { readJson, startTestServer, type TestServer } from '../testing/server.js';
import { signupAndVerify } from '../testing/signup.js';
import type { AuthSession } from '../types.js';
import { setTierEnforcedForTests } from '../billing/tier-usage.js';

// Правила тарифа для внешних сервисов — в routes/google-tier.test.ts; здесь — поведение Google.
setTierEnforcedForTests(false);

setProductSwitchForTests('googleSheets', true);

async function setup(t: test.TestContext) {
  const google = createFakeGoogle();
  const connections = createGoogleConnectionStore({ secret: 'route-delivery-secret' });
  const delivery = createSheetsDelivery({
    stores: getDiscoveryStores,
    connections,
    settings: () => FAKE_GOOGLE_SETTINGS,
    siteUrl: () => 'https://ketner.org',
    ownerEmail: () => null,
    fetchImpl: google.fetchImpl,
    log: () => {},
  });
  const originalWarn = console.warn;
  console.warn = () => {};
  const server = await startTestServer(
    {},
    {
      googleFetch: google.fetchImpl,
      googleSettings: () => FAKE_GOOGLE_SETTINGS,
      googleConnectionStore: connections,
      googleDelivery: delivery,
    },
  );
  t.after(async () => {
    console.warn = originalWarn;
    await server.close();
  });
  return { server, google, delivery };
}

async function signup(server: TestServer, name: string): Promise<AuthSession> {
  return readJson<AuthSession>(
    await signupAndVerify(server.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
        password: 'password123',
        name,
      }),
    }),
  );
}

function call(server: TestServer, session: AuthSession | null, method: string, path: string) {
  return fetch(`${server.baseUrl}/api/integrations/google${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: method === 'POST' ? '{}' : undefined,
  });
}

/** Подключение через настоящие маршруты: start → callback → confirm. */
async function connect(server: TestServer, session: AuthSession) {
  const start = await readJson<{ url: string }>(
    await fetch(`${server.baseUrl}/api/integrations/google/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ returnTo: 'http://localhost:5173/solutions/s1' }),
    }),
  );
  const state = new URL(start.url).searchParams.get('state')!;
  const confirm = await fetch(`${server.baseUrl}/api/integrations/google/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ code: 'code-1', state }),
  });
  assert.equal(confirm.status, 200);
}

async function botWithLead(session: AuthSession, leadId: string) {
  const stores = getDiscoveryStores()!;
  const solutionId = `sol-${session.user.id}`;
  if (!(await stores.builder.getSolution(session.user.id, solutionId))) {
    await stores.builder.createSolution(
      { id: solutionId, ownerId: session.user.id, type: 'customer_bot', name: 'Бот' } as Solution,
      { solutionId, number: 1, config: {} as never, createdAt: new Date().toISOString() },
      [],
    );
  }
  const lead: BotLead = {
    id: leadId,
    solutionId,
    ownerId: session.user.id,
    conversationId: null,
    name: 'Анна',
    contact: '+7 900',
    question: 'Вопрос',
    status: 'new',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await stores.builder.createLead(lead);
  return { solutionId, lead };
}

test('кабинет: отметки у заявок, повтор, новая таблица и «дописать пропущенные»', async (t) => {
  const { server, google, delivery } = await setup(t);
  const owner = await signup(server, 'owner');
  await connect(server, owner);

  // Заявка записана — «в таблице».
  const first = await botWithLead(owner, `lead-a-${owner.user.id}`);
  await delivery.onLeadCreated(first.lead);
  const states = await readJson<{ states: Record<string, string> }>(
    await call(server, owner, 'GET', `/deliveries?solutionId=${first.solutionId}`),
  );
  assert.deepEqual(states.states, { [first.lead.id]: 'written' });

  // Отказ Google (400) — «не записано»; «повторить» пишет строку.
  google.appendStatus = 400;
  const second = await botWithLead(owner, `lead-b-${owner.user.id}`);
  await delivery.onLeadCreated(second.lead);
  const status = await readJson<{ pending: number; status: string }>(
    await call(server, owner, 'GET', ''),
  );
  assert.equal(status.pending, 1);
  google.appendStatus = 200;
  const retried = await call(server, owner, 'POST', `/leads/${second.lead.id}/retry`);
  assert.equal(retried.status, 200);
  assert.deepEqual(await readJson(retried), { result: 'retrying', state: 'written' });

  // Чужую заявку повторить нельзя.
  const stranger = await signup(server, 'stranger');
  await connect(server, stranger);
  assert.equal(
    (await call(server, stranger, 'POST', `/leads/${second.lead.id}/retry`)).status,
    404,
  );
  assert.equal((await call(server, null, 'POST', `/leads/${second.lead.id}/retry`)).status, 401);

  // Таблица удалена: sheet_missing → новая таблица → дописать пропущенные.
  google.appendStatus = 404;
  const third = await botWithLead(owner, `lead-c-${owner.user.id}`);
  await delivery.onLeadCreated(third.lead);
  const missing = await readJson<{ status: string; pending: number }>(
    await call(server, owner, 'GET', ''),
  );
  assert.equal(missing.status, 'sheet_missing');
  assert.equal(missing.pending, 1);
  assert.equal(
    (await call(server, owner, 'POST', '/backfill')).status,
    409,
    'сначала новая таблица',
  );

  google.appendStatus = 200;
  const fresh = await readJson<{ status: string; spreadsheetUrl: string }>(
    await call(server, owner, 'POST', '/new-sheet'),
  );
  assert.equal(fresh.status, 'connected');
  const backfill = await readJson<{ retried: number; pending: number }>(
    await call(server, owner, 'POST', '/backfill'),
  );
  assert.equal(backfill.retried, 1);
  assert.equal(backfill.pending, 0);
});
