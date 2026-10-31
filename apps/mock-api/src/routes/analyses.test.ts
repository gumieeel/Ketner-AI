import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { GatewayRequest, GatewayStreamCallbacks } from '../ai/gateway-types.js';
import { createApp } from '../app.js';
import { publicAnalysis } from './analyses.js';
import { MemoryBudgetStore } from '../discovery/budget.js';
import { DiscoveryService } from '../discovery/service.js';
import { MemoryDiscoveryStore } from '../discovery/store.js';
import { contextTemplate, discoveryTemplate } from '../discovery/templates.js';
import type { MailMessage } from '../services/mailer.js';
import { createConversationStore } from '../store/conversation-store.js';
import { createSubscriptionStore } from '../store/subscription-store.js';
import { createUserStore } from '../store/user-store.js';
import { UsageStore } from '../store/usage-store.js';
import { isCodeMail, rememberCodeMails, signupAndVerify } from '../testing/signup.js';

type AnalysisView = ReturnType<typeof publicAnalysis>;

/** Ответ API анализа: анализ, список или ошибка с подробностями отказа. */
interface ApiBody {
  analysis: AnalysisView;
  /** GET: цена обновления анализа; continue: запущен ли повторный поиск. */
  rerun: unknown;
  analyses: Array<{ id: string }>;
  error: {
    code: string;
    message: string;
    details: {
      reason: string;
      paid: { model: string; typicalCredits: number; maxCredits: number };
    };
  };
}

interface OfferBody {
  free: { available: boolean; model?: string };
  paid: { model: string };
  deep: { model: string; confirmationRequired: boolean };
}

const TEXT = 'Веду интернет-магазин, отвечаю покупателям на однотипные вопросы каждый день.';

/** Шлюз на демо-шаблонах: те же ответы, что видит разработчик без ключей. */
const templateGateway = {
  async stream(request: GatewayRequest, callbacks: GatewayStreamCallbacks) {
    const stage = request.task?.id.split(':')[1];
    const input = request.messages[0]?.content ?? '';
    const text = stage === 'context' ? contextTemplate(input, 'ru') : discoveryTemplate('ru');
    callbacks.onDelta(text);
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

async function start(discoveryEnabled = true) {
  const dir = mkdtempSync(join(tmpdir(), 'ketner-analyses-'));
  const mails: MailMessage[] = [];
  const service = new DiscoveryService({
    store: new MemoryDiscoveryStore(),
    budget: new MemoryBudgetStore(),
    gateway: templateGateway,
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
    discoveryEnabled,
    discovery: { service },
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

const guestHeaders = (guestId: string, extra: Record<string, string> = {}) => ({
  'Content-Type': 'application/json',
  'X-Guest-Id': guestId,
  ...extra,
});

async function post(base: string, path: string, body: unknown, headers: Record<string, string>) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as ApiBody };
}

test('без DISCOVERY_ENABLED маршрутов анализа нет', async () => {
  const app = await start(false);
  try {
    const response = await fetch(`${app.base}/api/analyses`, {
      headers: guestHeaders('guest_flagoff123'),
    });
    assert.equal(response.status, 404);
  } finally {
    app.close();
  }
});

test('гость проходит анализ целиком; чужой гость видит 404; служебные поля не отдаются', async () => {
  const app = await start();
  try {
    const guest = 'guest_httpflow01';
    const offer = await fetch(`${app.base}/api/analyses/offer`, { headers: guestHeaders(guest) });
    const offered = (await offer.json()) as OfferBody;
    assert.equal(offered.free.available, true);
    assert.equal(offered.free.model, 'GPT-6 Luna');
    assert.equal(offered.paid.model, 'MiMo-V2.6 Pro');
    assert.equal(offered.deep.model, 'Claude Sonnet 5.5');
    assert.equal(offered.deep.confirmationRequired, true);

    const created = await post(app.base, '/api/analyses', { text: TEXT }, guestHeaders(guest));
    assert.equal(created.status, 202);
    const id = created.json.analysis.id as string;
    assert.equal(created.json.analysis.status, 'analyzing');
    for (const hidden of ['ownerId', 'ipHash', 'idempotencyKey', 'version', 'ipLimited']) {
      assert.ok(!(hidden in created.json.analysis), `${hidden} не отдаётся`);
    }
    await app.service.whenIdle();

    const waiting = await fetch(`${app.base}/api/analyses/${id}`, { headers: guestHeaders(guest) });
    const asked = ((await waiting.json()) as ApiBody).analysis;
    assert.equal(asked.status, 'needs_answers');
    assert.equal(asked.stages.context?.model?.name, 'GPT-6 Luna');

    const stranger = await fetch(`${app.base}/api/analyses/${id}`, {
      headers: guestHeaders('guest_stranger01'),
    });
    assert.equal(stranger.status, 404);

    // Черновик ответов: сохраняется, переживает перезагрузку; чужому гостю — 404.
    const draft = await fetch(`${app.base}/api/analyses/${id}/answers`, {
      method: 'PUT',
      headers: guestHeaders(guest),
      body: JSON.stringify({ answers: { q2: { value: 'В табли' } } }),
    });
    assert.equal(draft.status, 200);
    const reloaded = await fetch(`${app.base}/api/analyses/${id}`, {
      headers: guestHeaders(guest),
    });
    assert.deepEqual(((await reloaded.json()) as ApiBody).analysis.answers, {
      q2: { value: 'В табли' },
    });
    const foreignDraft = await fetch(`${app.base}/api/analyses/${id}/answers`, {
      method: 'PUT',
      headers: guestHeaders('guest_stranger01'),
      body: JSON.stringify({ answers: { q2: { value: 'x' } } }),
    });
    assert.equal(foreignDraft.status, 404);

    const continued = await post(
      app.base,
      `/api/analyses/${id}/continue`,
      { answers: { q2: { value: 'В таблицах' } } },
      guestHeaders(guest),
    );
    assert.equal(continued.status, 202);
    await app.service.whenIdle();
    const done = await fetch(`${app.base}/api/analyses/${id}`, { headers: guestHeaders(guest) });
    const report = ((await done.json()) as ApiBody).analysis;
    assert.equal(report.status, 'ready');
    assert.deepEqual(
      report.opportunities.map((item: { feasibilityStatus: string }) => item.feasibilityStatus),
      ['ready', 'needs_setup', 'not_supported'],
    );
    assert.deepEqual(report.cost, { chargedCredits: 0, sponsored: true });
    // Цена обновления при изменении ответов видна заранее; гостю — через вход.
    const rerunQuote = (
      (await (
        await fetch(`${app.base}/api/analyses/${id}`, { headers: guestHeaders(guest) })
      ).json()) as ApiBody
    ).rerun as { model: string; loginRequired: boolean } | null;
    assert.equal(rerunQuote?.model, 'GPT-6 Luna');
    assert.equal(rerunQuote?.loginRequired, true);
    const same = await post(
      app.base,
      `/api/analyses/${id}/continue`,
      { answers: { q2: { value: 'В таблицах' } } },
      guestHeaders(guest),
    );
    assert.equal(same.status, 200);
    assert.equal(same.json.rerun, false);
    const changed = await post(
      app.base,
      `/api/analyses/${id}/continue`,
      { answers: { q2: { value: 'В CRM' } }, confirm: true },
      guestHeaders(guest),
    );
    assert.equal(changed.status, 401);
    assert.equal(changed.json.error.code, 'login_required');

    const list = await fetch(`${app.base}/api/analyses`, { headers: guestHeaders(guest) });
    assert.equal(((await list.json()) as ApiBody).analyses.length, 1);

    // Сохранить гостю нельзя; удалить своё — можно, чужое — 404.
    const save = await fetch(`${app.base}/api/analyses/${id}`, {
      method: 'PATCH',
      headers: guestHeaders(guest),
      body: JSON.stringify({ saved: true }),
    });
    assert.equal(save.status, 401);
    const foreignDelete = await fetch(`${app.base}/api/analyses/${id}`, {
      method: 'DELETE',
      headers: guestHeaders('guest_stranger01'),
    });
    assert.equal(foreignDelete.status, 404);
    const deleted = await fetch(`${app.base}/api/analyses/${id}`, {
      method: 'DELETE',
      headers: guestHeaders(guest),
    });
    assert.equal(deleted.status, 204);
    const gone = await fetch(`${app.base}/api/analyses/${id}`, { headers: guestHeaders(guest) });
    assert.equal(gone.status, 404);
  } finally {
    app.close();
  }
});

test('проверка запроса: гостевой id, длина текста, Idempotency-Key, частота', async () => {
  const app = await start();
  try {
    const noGuest = await post(
      app.base,
      '/api/analyses',
      { text: TEXT },
      { 'Content-Type': 'application/json' },
    );
    assert.equal(noGuest.status, 400);
    assert.equal(noGuest.json.error.code, 'invalid_guest_id');

    const guest = 'guest_validate01';
    const short = await post(app.base, '/api/analyses', { text: 'коротко' }, guestHeaders(guest));
    assert.equal(short.json.error.code, 'text_too_short');
    const long = await post(
      app.base,
      '/api/analyses',
      { text: 'а'.repeat(8001) },
      guestHeaders(guest),
    );
    assert.equal(long.status, 413);
    const badKey = await post(
      app.base,
      '/api/analyses',
      { text: TEXT },
      guestHeaders(guest, { 'Idempotency-Key': 'x' }),
    );
    assert.equal(badKey.json.error.code, 'invalid_idempotency_key');

    const key = { 'Idempotency-Key': 'net-retry-0001' };
    const first = await post(app.base, '/api/analyses', { text: TEXT }, guestHeaders(guest, key));
    const repeat = await post(app.base, '/api/analyses', { text: TEXT }, guestHeaders(guest, key));
    assert.equal(first.status, 202);
    assert.equal(repeat.status, 200);
    assert.equal(repeat.json.analysis.id, first.json.analysis.id);

    // Третий запуск за минуту — отказ «дневной лимит», четвёртый — частота.
    const third = await post(app.base, '/api/analyses', { text: TEXT }, guestHeaders(guest));
    assert.equal(third.json.error.code, 'free_unavailable');
    assert.equal(third.json.error.details.reason, 'daily_limit');
    assert.equal(third.json.error.details.paid.model, 'MiMo-V2.6 Pro');
    await post(app.base, '/api/analyses', { text: TEXT }, guestHeaders(guest));
    const throttled = await post(app.base, '/api/analyses', { text: TEXT }, guestHeaders(guest));
    assert.equal(throttled.status, 429);

    // Анализ за кредиты гостю — только после входа.
    const paid = await post(
      app.base,
      '/api/analyses',
      { text: TEXT, mode: 'paid' },
      guestHeaders('guest_paidtry01'),
    );
    assert.equal(paid.status, 401);
    assert.equal(paid.json.error.code, 'login_required');
    await app.service.whenIdle();
  } finally {
    app.close();
  }
});

test('после входа анализ, начатый гостем в этом браузере, переходит в аккаунт', async () => {
  const app = await start();
  try {
    const guest = 'guest_beforelogin';
    const created = await post(app.base, '/api/analyses', { text: TEXT }, guestHeaders(guest));
    const id = created.json.analysis.id as string;
    await app.service.whenIdle();

    const signup = await signupAndVerify(app.base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'analysis-owner@example.com',
        password: 'password123',
        name: 'Owner',
      }),
    });
    const { token } = (await signup.json()) as { token: string };
    const authed = (guestId: string) => ({
      Authorization: `Bearer ${token}`,
      'X-Guest-Id': guestId,
    });

    // С чужим гостевым id анализ не переносится.
    const foreign = await fetch(`${app.base}/api/analyses/${id}`, {
      headers: authed('guest_otherbrowser'),
    });
    assert.equal(foreign.status, 404);
    const claimed = await fetch(`${app.base}/api/analyses/${id}`, { headers: authed(guest) });
    assert.equal(claimed.status, 200);
    const view = ((await claimed.json()) as ApiBody).analysis;
    assert.equal(view.guest, false);
    const saved = await fetch(`${app.base}/api/analyses/${id}`, {
      method: 'PATCH',
      headers: { ...authed(guest), 'Content-Type': 'application/json' },
      body: JSON.stringify({ saved: true }),
    });
    assert.equal(saved.status, 200);
    const listed = await fetch(`${app.base}/api/analyses`, { headers: authed(guest) });
    const items = ((await listed.json()) as { analyses: Array<{ id: string; saved: boolean }> })
      .analyses;
    assert.deepEqual(
      items.map((item) => [item.id, item.saved]),
      [[id, true]],
    );
    // Гостевой id больше не владелец.
    const asGuest = await fetch(`${app.base}/api/analyses/${id}`, { headers: guestHeaders(guest) });
    assert.equal(asGuest.status, 404);
  } finally {
    app.close();
  }
});
