import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantConfigBodySchema, botSettingsBodySchema } from '../builder/schemas.js';
import {
  agentApprovals,
  agentSpecFromLegacy,
  agentSpecSchema,
  agentSpecToLegacy,
  BOT_REPLY_CAP_CREDITS,
  checkAgentSpec,
  isAgentTemplate,
  legacyApprovalPolicy,
  LegacyMappingError,
} from './agent-spec.js';
import { assistantConfig, botSettings, legacySources } from '../testing/platform-fixtures.js';

test('фикстуры — допустимые сохранённые настройки (проходят схемы Builder)', () => {
  for (const { title, source } of legacySources) {
    assert.ok(assistantConfigBodySchema.safeParse(source.config).success, title);
    if (source.bot) assert.ok(botSettingsBodySchema.safeParse(source.bot).success, title);
  }
});

test('существующие настройки → AgentSpec → обратно без потерь', () => {
  for (const { title, source } of legacySources) {
    const spec = agentSpecFromLegacy(source);
    assert.ok(agentSpecSchema.safeParse(spec).success, title);
    const back = agentSpecToLegacy(spec, source.template);
    assert.deepEqual(back.config, source.config, title);
    assert.deepEqual(back.bot, source.bot, title);
  }
});

test('перевод не меняет входные объекты', () => {
  const source = legacySources[3]!.source;
  const snapshot = structuredClone(source);
  const spec = agentSpecFromLegacy(source);
  spec.knowledge.examples[0]!.input = 'changed';
  spec.knowledge.corrections[0]!.answer = 'changed';
  assert.deepEqual(source, snapshot);
});

test('AgentSpec из бота: канал, потолки и поведение из кода бота', () => {
  const spec = agentSpecFromLegacy({
    template: 'customer_bot',
    config: assistantConfig(),
    bot: botSettings(),
  });
  assert.equal(spec.channel.kind, 'public_page');
  assert.equal(spec.limits.dailyCapCredits, 1000);
  assert.equal(spec.modelPolicy.maxCreditsPerReply, BOT_REPLY_CAP_CREDITS);
  assert.equal(BOT_REPLY_CAP_CREDITS, 30);
  assert.ok(spec.allowedActions.includes('lead.create'));
  assert.deepEqual(
    spec.escalation.map((rule) => rule.when),
    ['unknown_answer', 'customer_asks_human', 'credits_exhausted'],
  );
  assert.deepEqual(checkAgentSpec(spec), []);
});

test('AgentSpec из личного помощника: чат Ketner, без потолка и без формы заявки', () => {
  const spec = agentSpecFromLegacy({
    template: 'personal_assistant',
    config: assistantConfig(),
    bot: null,
  });
  assert.equal(spec.channel.kind, 'ketner_chat');
  assert.equal(spec.limits.dailyCapCredits, null);
  assert.deepEqual(spec.allowedActions, ['reply.draft']);
  assert.deepEqual(checkAgentSpec(spec), []);
});

test('несогласованные исходные данные отклоняются', () => {
  assert.throws(
    () => agentSpecFromLegacy({ template: 'customer_bot', config: assistantConfig(), bot: null }),
    (error: unknown) =>
      error instanceof LegacyMappingError && error.code === 'bot_settings_missing',
  );
  assert.throws(
    () =>
      agentSpecFromLegacy({
        template: 'personal_assistant',
        config: assistantConfig(),
        bot: botSettings(),
      }),
    (error: unknown) =>
      error instanceof LegacyMappingError && error.code === 'bot_settings_unexpected',
  );
  const botSpec = agentSpecFromLegacy({
    template: 'customer_bot',
    config: assistantConfig(),
    bot: botSettings(),
  });
  assert.throws(() => agentSpecToLegacy(botSpec, 'personal_assistant'), LegacyMappingError);
  assert.equal(isAgentTemplate('study_assistant'), false);
});

test('схема: строгая, без рантайма и без лишних полей', () => {
  const spec = agentSpecFromLegacy(legacySources[0]!.source);
  assert.equal(agentSpecSchema.safeParse({ ...spec, runtime: 'mastra' }).success, false);
  assert.equal(agentSpecSchema.safeParse({ ...spec, price: 10 }).success, false);
  assert.equal(agentSpecSchema.safeParse({ ...spec, name: '   ' }).success, false);
  assert.equal(agentSpecSchema.safeParse({ ...spec, specVersion: 2 }).success, false);
  assert.equal(
    agentSpecSchema.safeParse({
      ...spec,
      channel: { kind: 'public_page', slug: 'Bad Slug', greeting: '', quickReplies: [] },
    }).success,
    false,
  );
  assert.equal(
    agentSpecSchema.safeParse({ ...spec, limits: { ...spec.limits, dailyCapCredits: 10 } }).success,
    false,
  );
  assert.equal(
    agentSpecSchema.safeParse({ ...spec, input: { kind: 'structured', fields: [] } }).success,
    false,
    'structured shape needs fields',
  );
});

test('проверки кодом: неизвестное, критичное и несогласованное', () => {
  const base = agentSpecFromLegacy(legacySources[3]!.source);
  const codes = (spec: typeof base) => checkAgentSpec(spec).map((issue) => issue.code);

  assert.deepEqual(codes({ ...base, allowedActions: [...base.allowedActions, 'shell.exec'] }), [
    'unknown_action',
  ]);
  assert.deepEqual(codes({ ...base, allowedActions: [...base.allowedActions, 'payment.refund'] }), [
    'forbidden_action',
  ]);
  assert.deepEqual(
    checkAgentSpec(
      { ...base, allowedActions: [...base.allowedActions, 'payment.refund'] },
      {
        verifiedCriticalProcesses: { 'payment.refund': 'refund-process-v1' },
      },
    ),
    [],
  );
  assert.deepEqual(
    codes({ ...base, allowedActions: ['knowledge.search', 'knowledge.search', 'lead.create'] }),
    ['duplicate_action'],
  );
  assert.deepEqual(codes({ ...base, allowedActions: ['knowledge.search'] }), ['escalation_action']);
  assert.ok(codes({ ...base, channel: { kind: 'ketner_chat' } }).includes('escalation_channel'));
});

test('одобрения агента считаются кодом по словарю действий', () => {
  const spec = agentSpecFromLegacy(legacySources[3]!.source);
  const withBulk = { ...spec, allowedActions: [...spec.allowedActions, 'message.bulk_send'] };
  const approvals = agentApprovals(withBulk);
  assert.equal(
    approvals.find((item) => item.action === 'message.bulk_send')?.requirement,
    'required',
  );
  assert.equal(approvals.find((item) => item.action === 'lead.create')?.requirement, 'none');
});

test('поведение существующих агентов сохраняется: им не нужны новые одобрения', () => {
  for (const { title, source } of legacySources) {
    const spec = agentSpecFromLegacy(source);
    const policy = legacyApprovalPolicy(source.template);
    for (const item of agentApprovals(spec, policy)) {
      assert.equal(item.requirement, 'none', `${title}: ${item.action}`);
    }
  }
  // Без разрешения, которое даёт включение бота, ответ клиенту требовал бы одобрения.
  const bot = agentSpecFromLegacy(legacySources[3]!.source);
  assert.equal(
    agentApprovals(bot).find((item) => item.action === 'reply.send_in_session')?.requirement,
    'required',
  );
});
