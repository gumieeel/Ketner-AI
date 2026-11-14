import assert from 'node:assert/strict';
import test from 'node:test';
import type { CapabilityAvailability, CapabilityId } from '../discovery/capabilities.js';
import { RUNTIME_PROFILES } from './runtime-binding.js';
import {
  evaluateSolution,
  N8N_COMMUNITY,
  registryAvailability,
  type CompatibilityContext,
  type WorkflowProviderProfile,
} from './compatibility.js';
import { solutionSpecSchema, type SolutionSpec } from './solution-spec.js';
import { supportSolution } from '../testing/platform-fixtures.js';

const allAvailable = (): CapabilityAvailability => 'available';
const ctx = (overrides: Partial<CompatibilityContext> = {}): CompatibilityContext => ({
  workflowProvider: N8N_COMMUNITY,
  workflowProviderDeployed: true,
  capabilityAvailability: allAvailable,
  ...overrides,
});
const codes = (spec: SolutionSpec, context: CompatibilityContext) =>
  evaluateSolution(spec, context).issues.map((issue) => issue.code);

const withWorkflow = (
  spec: SolutionSpec,
  patch: Partial<SolutionSpec['components']['workflows'][number]>,
): SolutionSpec => ({
  ...spec,
  components: { ...spec.components, workflows: [{ ...spec.components.workflows[0]!, ...patch }] },
});

/** Условный другой исполнитель без лицензионных ограничений. */
const OTHER_ENGINE: WorkflowProviderProfile = {
  id: 'other_engine',
  label: 'Other engine',
  actions: [...N8N_COMMUNITY.actions],
  triggers: [...N8N_COMMUNITY.triggers],
  credentialModes: ['api_key'],
  license: () => ({ status: 'allowed' }),
};

test('готовый процесс каталога на n8n CE — готово к исполнению', () => {
  const report = evaluateSolution(supportSolution(), ctx());
  assert.equal(report.status, 'ready');
  assert.deepEqual(report.issues, []);
});

test('лицензия n8n — правило слоя совместимости, а не схемы', () => {
  const generated = withWorkflow(supportSolution(), { logicOrigin: 'generated', template: null });
  assert.ok(solutionSpecSchema.safeParse(generated).success, 'спецификация валидна');

  const onN8n = evaluateSolution(generated, ctx());
  assert.equal(onN8n.status, 'blocked');
  assert.deepEqual(
    onN8n.issues.map((issue) => issue.code),
    ['license_commercial_required'],
  );

  // Та же спецификация на другом исполнителе — без изменений и без блокировки.
  const onOther = evaluateSolution(generated, ctx({ workflowProvider: OTHER_ENGINE }));
  assert.equal(onOther.status, 'ready');
});

test('процесс, собранный сотрудником под клиента, разрешён на n8n CE', () => {
  const staff = withWorkflow(supportSolution(), {
    logicOrigin: 'staff_built',
    template: null,
    instantiation: 'per_customer',
  });
  assert.equal(evaluateSolution(staff, ctx()).status, 'ready');
});

test('копия шаблона на клиента: нужно письменное подтверждение, после него — готово', () => {
  const copy = withWorkflow(supportSolution(), { instantiation: 'per_customer' });
  const pending = evaluateSolution(copy, ctx());
  assert.equal(pending.status, 'needs_confirmation');
  assert.deepEqual(
    pending.issues.map((issue) => issue.code),
    ['license_confirmation:n8n_per_customer_copy'],
  );
  assert.equal(
    evaluateSolution(copy, ctx({ confirmations: new Set(['n8n_per_customer_copy']) })).status,
    'ready',
  );
});

test('возможности исполнителя: триггер и действия', () => {
  const chatTrigger = withWorkflow(supportSolution(), {
    trigger: { kind: 'chat_message', description: '' },
  });
  assert.deepEqual(codes(chatTrigger, ctx()), ['trigger_unsupported']);

  const spec = supportSolution({ permissions: [...supportSolution().permissions, 'price.change'] });
  const priceStep = withWorkflow(spec, {
    steps: [
      { key: 'price', action: 'price.change', description: 'Поменять цены', onError: 'stop' },
    ],
  });
  assert.deepEqual(codes(priceStep, ctx()), ['action_unsupported_by_provider']);
});

test('развёртывание: исполнитель не развёрнут или не выбран; рантайм агента не подключён', () => {
  assert.equal(
    evaluateSolution(supportSolution(), ctx({ workflowProviderDeployed: false })).status,
    'needs_setup',
  );
  assert.deepEqual(codes(supportSolution(), ctx({ workflowProvider: null })), [
    'no_workflow_provider',
  ]);
  const report = evaluateSolution(supportSolution(), ctx({ agentRuntime: 'mastra' }));
  assert.equal(report.status, 'needs_setup');
  assert.deepEqual(
    report.issues.map((issue) => issue.code),
    ['runtime_unavailable'],
  );
  const mastraOn = { ...RUNTIME_PROFILES, mastra: { ...RUNTIME_PROFILES.mastra, available: true } };
  assert.equal(
    evaluateSolution(supportSolution(), ctx({ agentRuntime: 'mastra', runtimeProfiles: mastraOn }))
      .status,
    'ready',
  );
});

test('интеграции: из требований решения и из действий', () => {
  const availability = (id: CapabilityId): CapabilityAvailability =>
    (({ crm: 'integration', messengers: 'unavailable', text_generation: 'setup' })[
      id as string
    ] as CapabilityAvailability) ?? 'available';
  const spec = supportSolution({
    permissions: [...supportSolution().permissions, 'record.update'],
    integrations: [
      { capability: 'messengers', purpose: 'Ответы в WhatsApp', connectedBy: 'customer' },
    ],
  });
  const report = evaluateSolution(spec, ctx({ capabilityAvailability: availability }));
  assert.equal(report.status, 'blocked');
  assert.deepEqual(report.issues.map((issue) => [issue.code, issue.severity]).sort(), [
    ['capability_unavailable', 'blocker'],
    ['integration_required', 'integration'],
    ['setup_required', 'setup'],
  ]);
});

test('одобрения при исполнении считаются из словаря и политики', () => {
  const spec = supportSolution({
    permissions: [...supportSolution().permissions, 'message.bulk_send', 'record.update'],
  });
  const report = evaluateSolution(
    spec,
    ctx({ approvalPolicy: { alwaysApprove: ['record.update'] } }),
  );
  const byAction = Object.fromEntries(
    report.approvals.map((item) => [item.action, item.requirement]),
  );
  assert.equal(byAction['message.bulk_send'], 'required');
  assert.equal(byAction['record.update'], 'required');
  assert.equal(byAction['lead.create'], 'none');

  // Ответ клиенту в чате бота — MEDIUM наружу: без заранее выданного разрешения нужен человек.
  assert.equal(byAction['reply.send_in_session'], 'required');
  const granted = evaluateSolution(
    spec,
    ctx({ approvalPolicy: { standingPermissions: ['reply.send_in_session'] } }),
  );
  assert.equal(
    granted.approvals.find((item) => item.action === 'reply.send_in_session')?.requirement,
    'none',
  );

  const refund = supportSolution({
    permissions: [...supportSolution().permissions, 'payment.refund'],
  });
  assert.ok(codes(refund, ctx()).includes('action_forbidden'));
});

test('по умолчанию доступность берётся из реестра Ketner', () => {
  assert.equal(registryAvailability('text_generation'), 'available');
  const report = evaluateSolution(supportSolution(), {
    workflowProvider: N8N_COMMUNITY,
    workflowProviderDeployed: true,
  });
  assert.equal(report.status, 'ready');
});
