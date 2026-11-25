import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountTiers, type AccountTier } from '../billing/account-tiers.js';
import { setTierEnforcedForTests } from '../billing/tier-usage.js';
import { defaultConfig } from '../builder/service.js';
import type { Solution } from '../builder/types.js';
import { getDiscoveryStores } from '../discovery/runtime.js';
import { setProductSwitchForTests } from '../product-switches.js';
import type { MailMessage, Mailer } from '../services/mailer.js';
import { DocStore } from '../store/doc-store.js';
import { FAKE_GOOGLE_SETTINGS, createFakeGoogle } from '../testing/fake-google.js';
import { readJson, startTestServer, type TestServer } from '../testing/server.js';
import { signupAndVerify } from '../testing/signup.js';
import type { AuthSession } from '../types.js';

/**
 * Внешние сервисы и тариф (решение владельца 23.11.2026): подключение Google Таблицы — только при
 * активном тарифе со свободным местом; тариф снят — запись в таблицу ждёт, уведомления владельцу
 * о заявках идут. Сервер собран как в production (доставку собирает routes/index.ts).
 */

setProductSwitchForTests('googleSheets', true);
setTierEnforcedForTests(true);

interface CardStatus {
  status: string | null;
  tier: { active: boolean; name: string | null; servicesUsed: number; servicesLimit: number };
}

async function setup(t: test.TestContext, otherServices = 0) {
  const google = createFakeGoogle();
  const tiers = new AccountTiers(new DocStore<AccountTier>('account_tiers_google_test'));
  const mails: MailMessage[] = [];
  const mailer: Mailer = {
    kind: 'smtp',
    async send(message) {
      mails.push(message);
    },
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  const server = await startTestServer(
    {},
    {
      googleFetch: google.fetchImpl,
      googleSettings: () => FAKE_GOOGLE_SETTINGS,
      accountTiers: tiers,
      mailer,
      otherExternalServices: () => otherServices,
      googlePicker: () => ({ apiKey: 'AIzaSyTest-picker-key_0123456789', appId: '123456789012' }),
    },
  );
  t.after(async () => {
    console.warn = originalWarn;
    await server.close();
  });
  return { server, google, tiers, mails };
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

function call(
  server: TestServer,
  session: AuthSession,
  method: string,
  path: string,
  body?: unknown,
) {
  return fetch(`${server.baseUrl}/api/integrations/google${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
}

type Refusal = {
  error: { code: string; message: string; details: Record<string, unknown> };
};

/** start → (Google) → confirm: код и state из адреса Google. */
async function start(server: TestServer, owner: AuthSession) {
  const response = await call(server, owner, 'POST', '/start', {
    returnTo: 'http://localhost:5173/solutions/s1',
  });
  return response;
}

async function connect(server: TestServer, owner: AuthSession) {
  const started = await start(server, owner);
  assert.equal(started.status, 200);
  const { url } = await readJson<{ url: string }>(started);
  const state = new URL(url).searchParams.get('state')!;
  return call(server, owner, 'POST', '/confirm', { code: 'code-1', state });
}

test('без тарифа: подключить Google Таблицу нельзя — понятная причина и ссылка на тарифы', async (t) => {
  const { server, google } = await setup(t);
  const owner = await signup(server, 'no-tier');

  const status = await readJson<CardStatus>(await call(server, owner, 'GET', ''));
  assert.deepEqual(status.tier, {
    active: false,
    name: null,
    servicesUsed: 0,
    servicesLimit: 0,
  });

  const refused = await start(server, owner);
  assert.equal(refused.status, 403);
  const body = await readJson<Refusal>(refused);
  assert.equal(body.error.code, 'tier_required');
  assert.match(body.error.message, /работает при активном тарифе/);
  assert.equal(body.error.details.pricingUrl, '/pricing');
  assert.deepEqual(server.googleVerifierStore.idsOf(owner.user.id), [], 'подключение не начато');
  assert.equal(google.tokenRequests.length, 0);
});

test('Start: одно место — подключение проходит; повторное согласие и переподключение места не берут', async (t) => {
  const { server, tiers } = await setup(t);
  const owner = await signup(server, 'start');
  await tiers.set(owner.user.id, 'start', 'admin');

  assert.equal((await connect(server, owner)).status, 200);
  const status = await readJson<CardStatus>(await call(server, owner, 'GET', ''));
  assert.deepEqual(status.tier, {
    active: true,
    name: 'Start',
    servicesUsed: 1,
    servicesLimit: 1,
  });
  // Тот же сервис ещё раз (например, после отзыва доступа) — можно.
  assert.equal((await connect(server, owner)).status, 200);
  // Отключил и подключил снова — место освободилось.
  await call(server, owner, 'DELETE', '/connection');
  assert.equal((await connect(server, owner)).status, 200);
});

test('нет свободного места: «Внешних сервисов: 1 из 1 — тариф Start» и следующий тариф', async (t) => {
  // Другой внешний сервис уже подключён (CRM в будущем) — место Start занято.
  const { server, tiers, google } = await setup(t, 1);
  const owner = await signup(server, 'full');
  await tiers.set(owner.user.id, 'start', 'admin');

  const refused = await start(server, owner);
  assert.equal(refused.status, 403);
  const body = await readJson<Refusal>(refused);
  assert.equal(body.error.code, 'service_limit');
  assert.equal(
    body.error.message,
    'Внешних сервисов: 1 из 1 — тариф Start. Чтобы подключить ещё один, нужен тариф Growth (до 2) — или отключите один из подключённых.',
  );
  assert.deepEqual(body.error.details, {
    used: 1,
    limit: 1,
    tier: 'start',
    nextTier: 'growth',
    pricingUrl: '/pricing',
  });
  assert.equal(google.tokenRequests.length, 0);

  // Growth — два места: проходит.
  await tiers.set(owner.user.id, 'growth', 'admin');
  assert.equal((await connect(server, owner)).status, 200);
});

test('тариф сняли, пока человек был в Google: подтверждение отклоняется до обмена кода', async (t) => {
  const { server, tiers, google } = await setup(t);
  const owner = await signup(server, 'lapse-confirm');
  await tiers.set(owner.user.id, 'start', 'admin');
  const started = await start(server, owner);
  const { url } = await readJson<{ url: string }>(started);
  const state = new URL(url).searchParams.get('state')!;

  await tiers.remove(owner.user.id);
  const refused = await call(server, owner, 'POST', '/confirm', { code: 'code-1', state });
  assert.equal(refused.status, 403);
  assert.equal((await readJson<Refusal>(refused)).error.code, 'tier_required');
  assert.equal(google.tokenRequests.length, 0, 'код у Google не обменивался');
});

/** Опубликованный бот владельца — заявка приходит на его публичный адрес. */
async function publishedBot(owner: AuthSession, slug: string) {
  const now = new Date().toISOString();
  const id = `bot-${slug}`;
  await getDiscoveryStores()!.builder.createSolution(
    {
      id,
      ownerId: owner.user.id,
      type: 'customer_bot',
      template: 'customer_bot',
      bot: { slug, greeting: '', quickReplies: [], dailyCapCredits: 1000, corrections: [] },
      status: 'active',
      name: 'Лиса',
      currentVersion: 1,
      activeVersion: 1,
      source: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    } as Solution,
    { solutionId: id, number: 1, config: defaultConfig('Лиса', 'ru'), createdAt: now },
    [],
  );
  return id;
}

async function leaveLead(server: TestServer, slug: string) {
  const response = await fetch(`${server.baseUrl}/api/b/${slug}/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      visitorId: 'v_tierlapsevisitor01',
      name: 'Анна',
      contact: '+7 700 000 00 00',
      question: 'Букет',
    }),
  });
  assert.equal(response.status, 201);
  return ((await response.json()) as { leadId?: string }).leadId;
}

async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 3000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('не дождались');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('тариф снят: запись в таблицу ждёт, письмо о заявке приходит; после продления — «Дописать пропущенные»', async (t) => {
  const { server, tiers, google, mails } = await setup(t);
  const owner = await signup(server, 'lapse');
  await tiers.set(owner.user.id, 'start', 'admin');
  assert.equal((await connect(server, owner)).status, 200);
  const solutionId = await publishedBot(owner, `lisa-tier-${Date.now().toString(36)}`);
  const slug = (await getDiscoveryStores()!.builder.getSolution(owner.user.id, solutionId))!.bot!
    .slug;

  await tiers.remove(owner.user.id);
  const status = await readJson<CardStatus>(await call(server, owner, 'GET', ''));
  assert.equal(status.status, 'connected', 'подключение не обрывается');
  assert.equal(status.tier.active, false);

  await leaveLead(server, slug);
  const deliveries = async () =>
    (
      await readJson<{ states: Record<string, string> }>(
        await call(server, owner, 'GET', `/deliveries?solutionId=${solutionId}`),
      )
    ).states;
  await until(async () => Object.values(await deliveries()).includes('waiting'));
  assert.equal(google.appendRequests.length, 0, 'в таблицу ничего не ушло');
  // Заявка не потерялась: письмо владельцу пришло.
  assert.ok(mails.some((mail) => mail.subject.startsWith('Новая заявка')));

  // Без тарифа «Дописать пропущенные» и выбор таблицы (Picker) — с понятным отказом.
  for (const [path, body] of [
    ['/backfill', {}],
    ['/picker-token', {}],
    ['/pick-sheet', { spreadsheetId: 'old-sheet-0123456789' }],
  ] as const) {
    const refused = await call(server, owner, 'POST', path, body);
    assert.equal(refused.status, 403, path);
    assert.equal((await readJson<Refusal>(refused)).error.code, 'tier_required', path);
  }

  // Тариф снова есть: «Дописать пропущенные» пишет заявку.
  await tiers.set(owner.user.id, 'start', 'admin');
  const backfill = await call(server, owner, 'POST', '/backfill');
  assert.equal(backfill.status, 200);
  await until(async () => Object.values(await deliveries()).every((state) => state === 'written'));
  assert.equal(google.appendRequests.length, 1);
});
