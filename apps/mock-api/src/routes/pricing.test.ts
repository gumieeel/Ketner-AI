/**
 * Сквозной путь сметы: анализ гостя → смета → вход → заявка со снимком → админка (настройки,
 * проверка, предложение, факт, калибровка) и границы доступа.
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { GatewayRequest, GatewayStreamCallbacks } from '../ai/gateway-types.js';
import { createApp } from '../app.js';
import { MemoryBudgetStore } from '../discovery/budget.js';
import { MemoryDiscoveryStore } from '../discovery/store.js';
import { DiscoveryService } from '../discovery/service.js';
import { contextTemplate, discoveryTemplate } from '../discovery/templates.js';
import type { DiscoveryStores } from '../discovery/runtime.js';
import { MemoryPricingStore } from '../pricing/store.js';
import type { MailMessage } from '../services/mailer.js';
import { createConversationStore } from '../store/conversation-store.js';
import { createSubscriptionStore } from '../store/subscription-store.js';
import { createUserStore } from '../store/user-store.js';
import { UsageStore } from '../store/usage-store.js';
import { isCodeMail, rememberCodeMails, signupAndVerify } from '../testing/signup.js';

/** Длинное описание: без уточняющих вопросов анализ сразу доходит до отчёта. */
const TEXT =
  'У меня небольшой интернет-магазин одежды в Караганде. Клиенты пишут в WhatsApp и Instagram, ' +
  'менеджеры вручную отвечают на одни и те же вопросы о размерах и доставке, принимают заказы и ' +
  'ведут таблицы. Хотелось бы автоматизировать эти процессы.';

const gateway = {
  async stream(request: GatewayRequest, callbacks: GatewayStreamCallbacks) {
    const stage = request.task?.id.split(':')[1];
    const input = request.messages[0]?.content ?? '';
    callbacks.onDelta(stage === 'context' ? contextTemplate(input, 'ru') : discoveryTemplate('ru'));
    callbacks.onDone({
      inputTokens: 1,
      outputTokens: 1,
      source: 'provider',
      finishReason: 'stop',
      canContinue: false,
      selectedModel: { id: request.modelId, name: request.modelId },
      costUsd: 0.001,
      creditsUsd: 0,
    });
  },
};

async function start() {
  const dir = mkdtempSync(join(tmpdir(), 'ketner-pricing-'));
  const mails: MailMessage[] = [];
  const discoveryStore = new MemoryDiscoveryStore();
  const pricing = new MemoryPricingStore();
  const stores = { store: discoveryStore, pricing } as unknown as DiscoveryStores;
  const service = new DiscoveryService({
    store: discoveryStore,
    budget: new MemoryBudgetStore(),
    gateway,
    balanceUsd: () => 0,
    userCapabilities: () => ({ hasPurchasedCredits: false, githubConnected: false }),
    freeDailyUsd: 5,
    budgetTimeZone: 'UTC',
  });
  const app = createApp({
    store: createConversationStore(join(dir, 'c.json')),
    userStore: createUserStore(join(dir, 'u.json')),
    subscriptionStore: createSubscriptionStore(join(dir, 's.json')),
    usageStore: new UsageStore(join(dir, 'usage.json')),
    discoveryEnabled: true,
    discovery: { service, stores: () => stores },
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
  return { base, service, close: () => server.close() };
}

async function call(
  base: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: response.status, json: (text ? JSON.parse(text) : null) as any, text };
}

async function signup(base: string, email: string) {
  const response = await signupAndVerify(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', name: 'Тест' }),
  });
  const { token } = (await response.json()) as { token: string };
  return token;
}

test('смета: от анализа до заявки, проверки администратором и калибровки', async () => {
  const app = await start();
  try {
    const guestId = 'guest_pricingflow0001';
    const guest = { 'X-Guest-Id': guestId };
    const created = await call(app.base, 'POST', '/api/analyses', guest, { text: TEXT });
    assert.equal(created.status, 202, created.text);
    const id = created.json.analysis.id as string;
    await app.service.whenIdle();

    // 1. Гость видит сметы готового анализа: по каждой возможности и общую.
    const view = await call(app.base, 'GET', `/api/analyses/${id}`, guest);
    assert.equal(view.status, 200);
    assert.equal(view.json.analysis.status, 'ready');
    const estimates = view.json.estimates;
    assert.ok(estimates, 'сметы посчитаны');
    assert.equal(estimates.enabled, true);
    const items = estimates.items as Array<Record<string, unknown> & { scopeKey: string }>;
    const opportunities = view.json.analysis.opportunities as Array<{
      id: string;
      title: string;
      workItems: unknown[];
    }>;
    assert.equal(items.filter((item) => item.scope === 'opportunity').length, opportunities.length);
    const combined = items.find((item) => item.scopeKey === 'combined') as unknown as {
      priceKzt: { min: number; expected: number; max: number };
      sharedSavingsKzt: number;
    };
    assert.ok(combined, 'общая смета есть');
    assert.ok(combined.priceKzt.min <= combined.priceKzt.expected);
    assert.ok(combined.sharedSavingsKzt > 0, 'подготовка и запуск один раз');
    // Возможность с 1С: работа не в цене, нужна проверка.
    const email = opportunities.find((item) => item.title.includes('письма'))!;
    const emailEstimate = items.find((item) => item.scopeKey === `opp:${email.id}`) as unknown as {
      excluded: Array<{ capabilityId: string; reason: string }>;
      requiresManualReview: boolean;
      confidence: string;
    };
    assert.deepEqual(
      emailEstimate.excluded.map((e) => [e.capabilityId, e.reason]),
      [['one_c_integration', 'not_offered']],
    );
    assert.equal(emailEstimate.requiresManualReview, true);
    assert.equal(emailEstimate.confidence, 'low');
    // Внутренняя экономика клиенту не видна.
    for (const secret of [
      'laborKzt',
      'billableHourlyRateKzt',
      'riskReserveKzt',
      'multiplierMilli',
      'hoursMin',
    ]) {
      assert.equal(view.text.includes(secret), false, secret);
    }
    // Повторное чтение — те же сметы (без пересчёта).
    const again = await call(app.base, 'GET', `/api/analyses/${id}`, guest);
    assert.deepEqual(
      again.json.estimates.items.map((item: { id: string }) => item.id),
      items.map((item) => item.id),
    );

    // 2. Гость заявку не отправит.
    const guestRequest = await call(app.base, 'POST', `/api/analyses/${id}/requests`, guest, {
      scopeKey: 'combined',
      contact: { name: 'Айгерим', phone: '+7 700 123 45 67' },
    });
    assert.equal(guestRequest.status, 401);
    assert.equal(guestRequest.json.error.code, 'login_required');

    // 3. После входа анализ переходит в аккаунт, заявка сохраняет снимок сметы.
    const token = await signup(app.base, 'shop-owner@example.com');
    const owner = { Authorization: `Bearer ${token}`, 'X-Guest-Id': guestId };
    const bad = await call(app.base, 'POST', `/api/analyses/${id}/requests`, owner, {
      scopeKey: 'combined',
      contact: { name: '', phone: 'abc' },
    });
    assert.equal(bad.status, 400);
    const missing = await call(app.base, 'POST', `/api/analyses/${id}/requests`, owner, {
      scopeKey: 'opp:nope',
      contact: { name: 'Айгерим', phone: '+77001234567' },
    });
    assert.equal(missing.status, 404);
    const key = { 'Idempotency-Key': 'request-key-0001' };
    const requestBody = {
      scopeKey: 'combined',
      message: 'Хотим начать с WhatsApp',
      contact: { name: 'Айгерим', phone: '+7 700 123 45 67' },
    };
    const made = await call(
      app.base,
      'POST',
      `/api/analyses/${id}/requests`,
      { ...owner, ...key },
      requestBody,
    );
    assert.equal(made.status, 201, made.text);
    const requestId = made.json.request.id as string;
    assert.equal(
      made.json.request.status,
      'technical_review',
      'с 1С — сразу на техническую проверку',
    );
    assert.deepEqual(made.json.request.preliminary.priceKzt, combined.priceKzt);
    assert.equal(made.json.request.contact.email, 'shop-owner@example.com');
    assert.equal(made.json.request.proposal, null);
    const repeat = await call(
      app.base,
      'POST',
      `/api/analyses/${id}/requests`,
      { ...owner, ...key },
      requestBody,
    );
    assert.equal(repeat.status, 200);
    assert.equal(repeat.json.request.id, requestId, 'повтор с тем же ключом — та же заявка');
    const mine = await call(app.base, 'GET', '/api/requests', owner);
    assert.equal(mine.json.requests.length, 1);
    const saved = await call(app.base, 'GET', `/api/analyses/${id}`, owner);
    assert.equal(saved.json.analysis.saved, true, 'анализ с заявкой сохранён');

    // 4. Чужой пользователь не видит ни заявку, ни анализ; без входа — 401.
    const strangerToken = await signup(app.base, 'stranger@example.com');
    const stranger = {
      Authorization: `Bearer ${strangerToken}`,
      'X-Guest-Id': 'guest_strangerxx0001',
    };
    assert.equal((await call(app.base, 'GET', `/api/requests/${requestId}`, stranger)).status, 404);
    assert.equal(
      (await call(app.base, 'POST', `/api/requests/${requestId}/cancel`, stranger)).status,
      404,
    );
    assert.equal((await call(app.base, 'GET', `/api/analyses/${id}`, stranger)).status, 404);
    assert.equal((await call(app.base, 'GET', '/api/requests', {})).status, 401);
    assert.equal(
      (
        await call(app.base, 'PATCH', `/api/analyses/${id}/profile`, stranger, {
          profile: emptyProfile(),
        })
      ).status,
      404,
    );

    // 5. Админка закрыта для обычных пользователей.
    assert.equal((await call(app.base, 'GET', '/api/admin/pricing/config', owner)).status, 403);
    assert.equal((await call(app.base, 'GET', '/api/admin/pricing/requests', {})).status, 403);
    const adminToken = await signup(app.base, 'test-admin@example.com');
    const admin = { Authorization: `Bearer ${adminToken}` };
    const config = await call(app.base, 'GET', '/api/admin/pricing/config', admin);
    assert.equal(config.status, 200);
    assert.equal(config.json.version.version, 1);

    // 6. Новая ставка — новая версия; без причины и со старой базой — отказ.
    const nextConfig = { ...config.json.version.config, billableHourlyRateKzt: 20_000 };
    const noReason = await call(app.base, 'PUT', '/api/admin/pricing/config', admin, {
      baseVersion: 1,
      config: nextConfig,
      reason: '',
    });
    assert.equal(noReason.status, 400);
    const invalid = await call(app.base, 'PUT', '/api/admin/pricing/config', admin, {
      baseVersion: 1,
      config: { ...nextConfig, billableHourlyRateKzt: -5 },
      reason: 'ошибка',
    });
    assert.equal(invalid.status, 400);
    const updated = await call(app.base, 'PUT', '/api/admin/pricing/config', admin, {
      baseVersion: 1,
      config: nextConfig,
      reason: 'Калибровка ставки',
    });
    assert.equal(updated.status, 200, updated.text);
    assert.equal(updated.json.version.version, 2);
    const stale = await call(app.base, 'PUT', '/api/admin/pricing/config', admin, {
      baseVersion: 1,
      config: nextConfig,
      reason: 'Повтор',
    });
    assert.equal(stale.status, 409);

    // Сметы клиента не меняются от новой ставки: ни в заявке, ни в анализе.
    const kept = await call(app.base, 'GET', `/api/requests/${requestId}`, owner);
    assert.deepEqual(kept.json.request.preliminary.priceKzt, combined.priceKzt);
    const keptView = await call(app.base, 'GET', `/api/analyses/${id}`, owner);
    assert.deepEqual(
      keptView.json.estimates.items.find(
        (item: { scopeKey: string }) => item.scopeKey === 'combined',
      ).priceKzt,
      combined.priceKzt,
    );

    // 7. Правка профиля — новое поколение смет по действующей версии (дороже), без модели.
    const profile = await call(app.base, 'PATCH', `/api/analyses/${id}/profile`, owner, {
      profile: {
        ...emptyProfile(),
        industry: 'online_store',
        city: 'Караганда',
        monthlyRequests: 900,
      },
    });
    assert.equal(profile.status, 200, profile.text);
    assert.equal(profile.json.analysis.context.profile.city, 'Караганда');
    assert.equal(profile.json.analysis.context.profile.edited, true);
    const recalculated = profile.json.estimates.items.find(
      (item: { scopeKey: string }) => item.scopeKey === 'combined',
    );
    assert.ok(recalculated.priceKzt.expected > combined.priceKzt.expected);
    assert.notEqual(recalculated.id, (combined as unknown as { id: string }).id);
    assert.equal(recalculated.monthly.usage.monthlyRequests, 900);
    assert.equal(recalculated.monthly.usage.status, 'forecast');

    // 8. Предложение нельзя отправить без утверждённой сметы.
    const early = await call(app.base, 'PATCH', `/api/admin/pricing/requests/${requestId}`, admin, {
      status: 'proposal_sent',
    });
    assert.equal(early.status, 409);
    const review = await call(
      app.base,
      'POST',
      `/api/admin/pricing/requests/${requestId}/review`,
      admin,
      {
        priceKzt: { min: 300_000, expected: 350_000, max: 400_000 },
        hours: { min: 20, expected: 25, max: 30 },
        workingDays: [7, 12],
        customerNote: 'Интеграцию с 1С делаем вторым этапом.',
        approve: true,
        reason: 'Проверили объём работ',
      },
    );
    assert.equal(review.status, 200, review.text);
    assert.equal(review.json.request.status, 'proposal_preparing');
    const notYet = await call(app.base, 'GET', `/api/requests/${requestId}`, owner);
    assert.equal(notYet.json.request.proposal, null, 'до отправки предложение клиенту не видно');
    const note = await call(app.base, 'PATCH', `/api/admin/pricing/requests/${requestId}`, admin, {
      status: 'proposal_sent',
      assignedAdminId: 'me',
      note: 'Внутренняя заметка: клиент торгуется',
      reason: 'Отправили предложение',
    });
    assert.equal(note.status, 200, note.text);

    const customerView = await call(app.base, 'GET', `/api/requests/${requestId}`, owner);
    assert.deepEqual(customerView.json.request.proposal.priceKzt, {
      min: 300_000,
      expected: 350_000,
      max: 400_000,
    });
    assert.equal(customerView.json.request.canAccept, true);
    assert.equal(customerView.text.includes('торгуется'), false, 'заметки клиенту не видны');
    assert.equal(customerView.text.includes('assignedAdminId'), false);
    const accepted = await call(app.base, 'POST', `/api/requests/${requestId}/accept`, owner);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.json.request.status, 'approved');
    assert.equal(
      (await call(app.base, 'POST', `/api/requests/${requestId}/accept`, owner)).status,
      409,
    );

    // 9. Факт проекта — только когда работа идёт; калибровка по факту.
    const tooEarly = await call(
      app.base,
      'PUT',
      `/api/admin/pricing/requests/${requestId}/actuals`,
      admin,
      {
        actualHours: 40,
        actualDirectKzt: 0,
        finalPriceKzt: 360_000,
      },
    );
    assert.equal(tooEarly.status, 409);
    await call(app.base, 'PATCH', `/api/admin/pricing/requests/${requestId}`, admin, {
      status: 'completed',
      reason: 'Сдали',
    });
    assert.equal(
      (await call(app.base, 'POST', `/api/requests/${requestId}/cancel`, owner)).status,
      409,
    );
    const actuals = await call(
      app.base,
      'PUT',
      `/api/admin/pricing/requests/${requestId}/actuals`,
      admin,
      {
        actualHours: 40,
        actualDirectKzt: 15_000,
        finalPriceKzt: 360_000,
        deviationReasons: 'Каталог пришлось чистить вручную',
      },
    );
    assert.equal(actuals.status, 200, actuals.text);
    const calibration = await call(app.base, 'GET', '/api/admin/pricing/calibration', admin);
    assert.equal(calibration.json.report.projects, 1);
    assert.ok(calibration.json.report.byCapability.length > 0);

    // 10. Журнал: кто, что было, что стало, почему.
    const detail = await call(app.base, 'GET', `/api/admin/pricing/requests/${requestId}`, admin);
    const actions = detail.json.audit.map((entry: { action: string }) => entry.action);
    for (const action of [
      'created',
      'estimate_approved',
      'admin_update',
      'customer_accept',
      'actuals_recorded',
    ]) {
      assert.ok(actions.includes(action), action);
    }
    const approval = detail.json.audit.find(
      (entry: { action: string }) => entry.action === 'estimate_approved',
    );
    assert.equal(approval.reason, 'Проверили объём работ');
    assert.deepEqual(approval.previous.priceKzt, combined.priceKzt);
    assert.equal(approval.next.priceKzt.expected, 350_000);
    assert.ok(approval.actorId && approval.actorId !== 'admin-key');
    const estimatesList = await call(app.base, 'GET', '/api/admin/pricing/estimates', admin);
    assert.ok(estimatesList.json.estimates.length >= items.length);
    const full = await call(
      app.base,
      'GET',
      `/api/admin/pricing/estimates/${requestIdEstimate(detail.json)}`,
      admin,
    );
    assert.ok(
      full.json.estimate.result.parameters.billableHourlyRateKzt > 0,
      'админ видит параметры',
    );
  } finally {
    app.close();
  }
});

test('каталог: правка работы — новая версия, неверная работа отклоняется', async () => {
  const app = await start();
  try {
    const admin = { Authorization: `Bearer ${await signup(app.base, 'test-admin@example.com')}` };
    const config = await call(app.base, 'GET', '/api/admin/pricing/config', admin);
    const sheets = config.json.version.catalog.find(
      (item: { id: string }) => item.id === 'google_sheets_integration',
    );
    const wrong = await call(
      app.base,
      'PUT',
      '/api/admin/pricing/catalog/google_sheets_integration',
      admin,
      {
        baseVersion: 1,
        item: { ...sheets, hoursMin: 10, hoursExpected: 2 },
        reason: 'ошибка',
      },
    );
    assert.equal(wrong.status, 400);
    const ok = await call(
      app.base,
      'PUT',
      '/api/admin/pricing/catalog/google_sheets_integration',
      admin,
      {
        baseVersion: 1,
        item: { ...sheets, hoursExpected: 5, status: 'disabled' },
        reason: 'Калибровка по проектам',
      },
    );
    assert.equal(ok.status, 200, ok.text);
    const item = ok.json.version.catalog.find(
      (entry: { id: string }) => entry.id === 'google_sheets_integration',
    );
    assert.equal(item.status, 'disabled');
    const created = await call(
      app.base,
      'PUT',
      '/api/admin/pricing/catalog/amocrm_integration',
      admin,
      {
        baseVersion: 2,
        item: { ...sheets, id: 'amocrm_integration', status: 'custom' },
        reason: 'Новая работа',
      },
    );
    assert.equal(created.status, 200);
    assert.equal(created.json.version.catalog.length, config.json.version.catalog.length + 1);
  } finally {
    app.close();
  }
});

function requestIdEstimate(detail: { request: { estimateId: string } }): string {
  return detail.request.estimateId;
}

function emptyProfile() {
  return {
    businessName: null,
    industry: null,
    subIndustry: null,
    city: null,
    businessModel: null,
    website: null,
    teamSize: null,
    customerChannels: ['whatsapp', 'instagram'],
    existingTools: [],
    monthlyRequests: null,
    monthlyOrders: null,
    additionalContext: null,
  };
}
