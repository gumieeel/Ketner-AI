import assert from 'node:assert/strict';
import test from 'node:test';
import type { GatewayRequest, GatewayStreamCallbacks } from '../ai/gateway-types.js';
import { MemoryDiscoveryStore } from '../discovery/store.js';
import type { Analysis, Opportunity } from '../discovery/types.js';
import { BuilderService, judgeVerdict, type BuilderCaller } from './service.js';
import { MemoryBuilderStore } from './store.js';

const DRAFT = JSON.stringify({
  name: 'Помощник магазина',
  purpose: 'Отвечает покупателям',
  instructions: 'Отвечай кратко, уточняй номер заказа.',
  tone: 'friendly',
  knowledge: '',
  examples: [{ input: 'Где заказ?', output: 'Подскажите номер заказа.' }],
  restrictions: ['Не выдумывай сроки'],
  testCases: [
    { input: 'Где мой заказ?', criteria: ['Просит номер заказа'] },
    { input: 'Сколько стоит доставка?', criteria: ['Не выдумывает цену'] },
  ],
});

function fakeGateway(options: { failJudgeFor?: string[] } = {}) {
  const requests: GatewayRequest[] = [];
  return {
    requests,
    gateway: {
      async stream(request: GatewayRequest, callbacks: GatewayStreamCallbacks) {
        requests.push(request);
        const id = request.task?.id ?? '';
        let text: string;
        if (id.includes(':draft:')) text = DRAFT;
        else if (id.includes(':judge:')) {
          const payload = request.messages[0].content;
          const fails = (options.failJudgeFor ?? []).some((input) => payload.includes(input));
          text = JSON.stringify({
            criteria: [{ criterion: 'c', met: !fails, note: '' }],
            notes: '',
          });
        } else text = `Ответ помощника на: ${request.messages.at(-1)?.content}`;
        callbacks.onDelta(text);
        callbacks.onDone({
          inputTokens: 1,
          outputTokens: 1,
          source: 'provider',
          finishReason: 'stop',
          canContinue: false,
          selectedModel: { id: request.task ? request.modelId : 'ketner-pro', name: 'x' },
          costUsd: 0.002,
          creditsUsd: 0.002,
        });
      },
    },
  };
}

function analysis(ownerId: string): Analysis {
  const now = '2026-10-31T10:00:00.000Z';
  return {
    id: 'an-1',
    ownerId,
    guest: false,
    ipHash: null,
    ipLimited: false,
    mode: 'free',
    language: 'ru',
    status: 'ready',
    inputText: 'Интернет-магазин',
    context: null,
    questions: [],
    answers: {},
    summary: 'Итог',
    stages: {},
    budgetDay: '2026-10-31',
    idempotencyKey: null,
    saved: false,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function opportunity(
  id: string,
  ownerId: string,
  status: Opportunity['feasibilityStatus'],
): Opportunity {
  return {
    id,
    analysisId: 'an-1',
    ownerId,
    position: 0,
    title: `Возможность ${id}`,
    problem: 'п',
    solution: 'р',
    requires: ['text_generation'],
    otherRequirement: null,
    dataNeeded: [],
    integrationsNeeded: [],
    effort: 'low',
    effortReason: '',
    risks: [],
    limitations: [],
    successCriteria: [],
    firstStep: '',
    feasibilityStatus: status,
    feasibility: { status, blockers: [], available: [] },
    impact: { kind: 'qualitative', benefit: 'б', missing: '', note: '' },
    priority: 0,
    createdAt: '2026-10-31T10:00:00.000Z',
  };
}

async function setup(options: { balanceUsd?: number; failJudgeFor?: string[] } = {}) {
  const discovery = new MemoryDiscoveryStore();
  const store = new MemoryBuilderStore();
  const fake = fakeGateway(options);
  await discovery.create(analysis('alice'));
  await discovery.setOpportunities('alice', 'an-1', [
    opportunity('o-ok', 'alice', 'ready'),
    opportunity('o-no', 'alice', 'not_supported'),
  ]);
  const service = new BuilderService({
    store,
    discovery,
    gateway: fake.gateway,
    balanceUsd: () => options.balanceUsd ?? 10,
  });
  return { service, store, requests: fake.requests };
}

const alice: BuilderCaller = {
  userId: 'alice',
  plan: 'credits',
  isVip: false,
  anonymous: false,
  language: 'ru',
};
const bob: BuilderCaller = { ...alice, userId: 'bob' };

test('вердикт судьи: «прошёл» только если выполнены все критерии', () => {
  const met = (values: boolean[]) => ({
    criteria: values.map((value) => ({ criterion: 'c', met: value, note: '' })),
    notes: '',
  });
  assert.equal(judgeVerdict(['a', 'b'], met([true, true])), 'pass');
  assert.equal(judgeVerdict(['a', 'b'], met([true, false])), 'fail');
  assert.equal(judgeVerdict(['a', 'b'], met([true])), 'fail', 'судья пропустил критерий');
});

test('черновик из возможности: цена и согласие, модель MiMo-V2.6 Pro, один помощник на возможность', async () => {
  const { service, requests } = await setup();
  const refused = await service.createFromOpportunity(alice, {
    analysisId: 'an-1',
    opportunityId: 'o-no',
    confirm: true,
  });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.code, 'opportunity_not_supported');

  const quote = service.draftQuote('ru');
  assert.equal(quote.model, 'MiMo-V2.6 Pro');
  const unconfirmed = await service.createFromOpportunity(alice, {
    analysisId: 'an-1',
    opportunityId: 'o-ok',
  });
  assert.equal(unconfirmed.ok, false);
  if (!unconfirmed.ok) {
    assert.equal(unconfirmed.code, 'confirmation_required');
    assert.equal(unconfirmed.details?.maxCredits, quote.maxCredits);
  }
  assert.equal(requests.length, 0);

  // Чужой анализ — не найден.
  const foreign = await service.createFromOpportunity(bob, {
    analysisId: 'an-1',
    opportunityId: 'o-ok',
    confirm: true,
  });
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.equal(foreign.status, 404);

  const created = await service.createFromOpportunity(alice, {
    analysisId: 'an-1',
    opportunityId: 'o-ok',
    confirm: true,
  });
  assert.equal(created.ok && created.created, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].modelId, 'ketner-pro');
  assert.equal(requests[0].strictModel, true);
  assert.equal(requests[0].task?.billing, 'user');
  assert.equal(requests[0].task?.kind, 'review');
  if (!created.ok) return;
  const view = await service.get('alice', created.solution.id);
  assert.equal(view?.config.name, 'Помощник магазина');
  assert.equal(view?.cases.length, 2);
  assert.equal(view?.solution.status, 'draft');
  assert.deepEqual(view?.readiness, { ready: false, reason: 'not_tested' });

  const again = await service.createFromOpportunity(alice, {
    analysisId: 'an-1',
    opportunityId: 'o-ok',
    confirm: true,
  });
  assert.equal(again.ok && !again.created && again.solution.id === created.solution.id, true);
  assert.equal(requests.length, 1, 'повтор не вызывает модель');
});

test('без баланса на потолок черновика — отказ с суммой', async () => {
  const { service, requests } = await setup({ balanceUsd: 0 });
  const result = await service.createFromOpportunity(alice, {
    analysisId: 'an-1',
    opportunityId: 'o-ok',
    confirm: true,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'insufficient_credits');
  assert.equal(requests.length, 0);
});

test('тесты и включение: только после прохождения всех кейсов текущей версией; правка — новая версия', async () => {
  const { service, requests } = await setup({ failJudgeFor: ['Сколько стоит доставка'] });
  const created = await service.createFromOpportunity(alice, {
    analysisId: 'an-1',
    opportunityId: 'o-ok',
    confirm: true,
  });
  if (!created.ok) return assert.fail('черновик не создан');
  const id = created.solution.id;

  // Включить без тестов нельзя.
  const early = await service.activate(alice, id);
  assert.equal(early.ok, false);
  if (!early.ok) assert.equal(early.details?.reason, 'not_tested');

  // Прогон — только с согласием.
  const unconfirmed = await service.runTests(alice, id);
  assert.equal(unconfirmed.ok, false);
  if (!unconfirmed.ok) assert.equal(unconfirmed.code, 'confirmation_required');
  const calls = requests.length;
  const started = await service.runTests(alice, id, true);
  assert.equal(started.ok, true);
  await service.whenIdle();
  // На каждый кейс — ответ помощника (Auto, тестовый прогон) и проверка судьёй.
  const runCalls = requests.slice(calls);
  assert.equal(runCalls.length, 4);
  const answers = runCalls.filter((request) => request.assistant);
  assert.equal(answers.length, 2);
  assert.ok(answers.every((request) => request.modelId === 'auto'));
  assert.ok(answers.every((request) => request.assistant?.testRunId));
  assert.ok(answers.every((request) => (request.assistant?.maxChargeUsd ?? 0) > 0));
  assert.match(answers[0].assistant?.instructions ?? '', /Отвечай кратко, уточняй номер заказа/);

  let view = await service.get('alice', id);
  assert.equal(view?.run?.status, 'done');
  assert.deepEqual(
    view?.run?.results.map((item) => item.judge?.verdict),
    ['pass', 'fail'],
  );
  assert.deepEqual(view?.readiness, { ready: false, reason: 'failed_cases', failed: 1 });

  // Вердикт вручную важнее судьи.
  const failedCase = view!.run!.results[1].caseId;
  await service.setVerdict(alice, id, view!.run!.id, failedCase, 'pass');
  view = await service.get('alice', id);
  assert.deepEqual(view?.readiness, { ready: true });
  // Чужой не меняет вердикт.
  const foreign = await service.setVerdict(bob, id, view!.run!.id, failedCase, 'fail');
  assert.equal(foreign.ok, false);

  const activated = await service.activate(alice, id);
  assert.equal(activated.ok && activated.solution.status, 'active');
  assert.equal(activated.ok && activated.solution.activeVersion, 1);
  assert.equal(
    (await service.activeConfig('alice', id))?.config.instructions.includes('кратко'),
    true,
  );

  // Сохранение тех же настроек — без новой версии; другие — версия 2, чат остаётся на версии 1.
  const same = await service.updateConfig(alice, id, view!.config);
  assert.equal(same.ok && same.changed, false);
  const changed = await service.updateConfig(alice, id, {
    ...view!.config,
    instructions: 'Отвечай очень подробно.',
  });
  assert.equal(changed.ok && changed.solution.currentVersion, 2);
  assert.equal(changed.ok && changed.solution.activeVersion, 1);
  assert.match((await service.activeConfig('alice', id))?.config.instructions ?? '', /кратко/);
  view = await service.get('alice', id);
  assert.deepEqual(view?.readiness, { ready: false, reason: 'outdated' });
  assert.deepEqual(
    view?.versions.map((item) => item.number),
    [2, 1],
  );
  const refused = await service.activate(alice, id);
  assert.equal(refused.ok, false);

  // Вернуть версию 1 — это версия 3 с теми же настройками.
  const restored = await service.restoreVersion(alice, id, 1);
  assert.equal(restored.ok && restored.solution.currentVersion, 3);

  // Изменили кейсы — прошлый прогон не подтверждает версию.
  await service.saveCase(alice, id, { input: 'Новый вопрос', criteria: ['Отвечает вежливо'] });
  assert.equal((await service.get('alice', id))?.readiness.ready, false);

  // Выключить — чат недоступен.
  await service.pause(alice, id);
  assert.equal(await service.activeConfig('alice', id), null);
});

test('чужой помощник не читается, не меняется и не удаляется', async () => {
  const { service } = await setup();
  const mine = await service.createBlank(alice, 'Мой помощник');
  assert.equal(await service.get('bob', mine.id), null);
  const edit = await service.updateConfig(bob, mine.id, {
    name: 'x',
    purpose: '',
    instructions: '',
    tone: 'neutral',
    knowledge: '',
    examples: [],
    restrictions: [],
    language: 'ru',
  });
  assert.equal(edit.ok, false);
  const addCase = await service.saveCase(bob, mine.id, { input: 'x', criteria: ['y'] });
  assert.equal(addCase.ok, false);
  const run = await service.runTests(bob, mine.id, true);
  assert.equal(run.ok, false);
  assert.equal(await service.remove(bob, mine.id), false);
  assert.ok(await service.get('alice', mine.id));
  assert.equal(await service.remove(alice, mine.id), true);
  assert.equal(await service.get('alice', mine.id), null);
});

test('цена тестов: на каждый кейс — ответ и проверка; «не больше» не меньше типичной', async () => {
  const { service } = await setup();
  const mine = await service.createBlank(alice, 'Помощник');
  await service.saveCase(alice, mine.id, { input: 'Вопрос', criteria: ['Критерий'] });
  await service.saveCase(alice, mine.id, { input: 'Вопрос 2', criteria: ['Критерий'] });
  const view = await service.get('alice', mine.id);
  const quote = service.testQuote(view!.config, view!.cases);
  assert.equal(quote.cases, 2);
  assert.equal(quote.judgeModel, 'MiMo-V2.6 Pro');
  assert.ok(quote.maxCredits >= quote.typicalCredits);
  assert.ok(quote.maxCredits > 0);
});
