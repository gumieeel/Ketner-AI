import assert from 'node:assert/strict';
import test from 'node:test';
import { checkSolutionSpec, solutionSpecSchema, type SolutionSpec } from './solution-spec.js';
import { supportSolution } from '../testing/platform-fixtures.js';

const parse = (spec: unknown) => solutionSpecSchema.safeParse(spec);
const workflow = (spec: SolutionSpec) => spec.components.workflows[0]!;

test('образец решения проходит схему и проверки словарей', () => {
  const spec = supportSolution();
  assert.ok(parse(spec).success);
  assert.deepEqual(checkSolutionSpec(spec), []);
});

test('схема строгая: цен, статусов и полей исполнителя нет', () => {
  const spec = supportSolution();
  for (const extra of [
    { price: 100 },
    { status: 'active' },
    { feasibility: 'ready' },
    { provider: 'n8n' },
  ]) {
    assert.equal(parse({ ...spec, ...extra }).success, false, JSON.stringify(extra));
  }
  const n8nWorkflow = { ...workflow(spec), n8nWorkflowId: 'abc' };
  assert.equal(
    parse({ ...spec, components: { ...spec.components, workflows: [n8nWorkflow] } }).success,
    false,
  );
  const modeWorkflow = { ...workflow(spec), mode: 'M2' };
  assert.equal(
    parse({ ...spec, components: { ...spec.components, workflows: [modeWorkflow] } }).success,
    false,
  );
});

test('независимость от исполнителя: логика, созданная ИИ, — валидная спецификация', () => {
  // Можно ли её исполнить конкретным исполнителем — решает слой совместимости, не схема.
  const spec = supportSolution();
  const generated: SolutionSpec = {
    ...spec,
    components: {
      ...spec.components,
      workflows: [
        {
          ...workflow(spec),
          logicOrigin: 'generated',
          template: null,
          instantiation: 'per_customer',
        },
      ],
    },
  };
  assert.ok(parse(generated).success);
  assert.deepEqual(checkSolutionSpec(generated), []);
});

test('стратегия согласована с составом решения', () => {
  const spec = supportSolution();
  assert.equal(
    parse({ ...spec, strategy: 'agent' }).success,
    false,
    'agent strategy with a workflow',
  );
  assert.equal(
    parse({ ...spec, strategy: 'workflow' }).success,
    false,
    'workflow strategy with an agent',
  );
  assert.ok(parse({ ...spec, strategy: 'workflow_calls_agent' }).success);
  const agentOnly = {
    ...spec,
    strategy: 'agent',
    components: { ...spec.components, workflows: [] },
  };
  assert.ok(parse(agentOnly).success);
  const toolOnly = {
    ...spec,
    type: 'tool',
    strategy: 'tool',
    components: {
      agents: [],
      workflows: [],
      tools: [{ key: 'study', template: 'study_assistant', purpose: 'Конспекты' }],
    },
  };
  assert.ok(parse(toolOnly).success);
});

test('шаблон указан только у процесса из каталога; ключи не повторяются', () => {
  const spec = supportSolution();
  const withoutTemplate = { ...workflow(spec), template: null };
  assert.equal(
    parse({ ...spec, components: { ...spec.components, workflows: [withoutTemplate] } }).success,
    false,
  );
  const staffWithTemplate = { ...workflow(spec), logicOrigin: 'staff_built' };
  assert.equal(
    parse({ ...spec, components: { ...spec.components, workflows: [staffWithTemplate] } }).success,
    false,
  );
  const repeatedSteps = {
    ...workflow(spec),
    steps: [workflow(spec).steps[0], workflow(spec).steps[0]],
  };
  assert.equal(
    parse({ ...spec, components: { ...spec.components, workflows: [repeatedSteps] } }).success,
    false,
  );
  const sameKey = { ...workflow(spec), key: 'support' };
  assert.equal(
    parse({ ...spec, components: { ...spec.components, workflows: [sameKey] } }).success,
    false,
  );
});

test('проверки словарей: неизвестное действие и действие вне прав', () => {
  const spec = supportSolution();
  assert.deepEqual(
    checkSolutionSpec({ ...spec, permissions: [...spec.permissions, 'shell.exec'] }).map(
      (issue) => issue.code,
    ),
    ['unknown_action'],
  );
  const steps = [
    ...workflow(spec).steps,
    { key: 'sms', action: 'message.send', description: 'SMS клиенту', onError: 'stop' as const },
  ];
  const issues = checkSolutionSpec({
    ...spec,
    components: { ...spec.components, workflows: [{ ...workflow(spec), steps }] },
  });
  assert.deepEqual(
    issues.map((issue) => [issue.code, issue.path]),
    [['action_not_permitted', 'components.workflows.0.steps.2.action']],
  );
});
