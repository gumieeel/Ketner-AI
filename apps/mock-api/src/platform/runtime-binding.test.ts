import assert from 'node:assert/strict';
import test from 'node:test';
import { agentSpecFromLegacy } from './agent-spec.js';
import {
  bindRuntime,
  DEFAULT_RUNTIME,
  RUNTIME_PROFILES,
  runtimeBindingSchema,
  runtimeIssues,
  type AgentRuntimeProfile,
} from './runtime-binding.js';
import { legacySources } from '../testing/platform-fixtures.js';

const bot = () => agentSpecFromLegacy(legacySources[3]!.source);
const withMastra = { ...RUNTIME_PROFILES, mastra: { ...RUNTIME_PROFILES.mastra, available: true } };

test('по умолчанию агент привязывается к существующему AgentGateway', () => {
  assert.equal(DEFAULT_RUNTIME, 'agent_gateway');
  const result = bindRuntime(bot(), { solutionId: 'sol_1', agentVersion: 3 });
  assert.deepEqual(result, {
    ok: true,
    binding: { bindingVersion: 1, solutionId: 'sol_1', agentVersion: 3, runtime: 'agent_gateway' },
  });
});

test('одна спецификация — два рантайма; спецификация не меняется', () => {
  const spec = bot();
  const snapshot = structuredClone(spec);
  const viaGateway = bindRuntime(
    spec,
    { solutionId: 'sol_1', agentVersion: 1, runtime: 'agent_gateway' },
    withMastra,
  );
  const viaMastra = bindRuntime(
    spec,
    { solutionId: 'sol_1', agentVersion: 1, runtime: 'mastra' },
    withMastra,
  );
  assert.ok(viaGateway.ok && viaMastra.ok);
  assert.equal(viaGateway.binding.runtime, 'agent_gateway');
  assert.equal(viaMastra.binding.runtime, 'mastra');
  assert.deepEqual(spec, snapshot);
});

test('Mastra не подключена в этой сборке — привязка отклоняется с причиной', () => {
  const result = bindRuntime(bot(), { solutionId: 'sol_1', agentVersion: 1, runtime: 'mastra' });
  assert.equal(result.ok, false);
  assert.deepEqual(!result.ok && result.issues.map((issue) => issue.code), ['runtime_unavailable']);
});

test('рантайм проверяет, что поддерживает спецификацию', () => {
  const spec = { ...bot(), memoryPolicy: { scope: 'task' as const, maxMessages: 12 } };
  assert.deepEqual(
    runtimeIssues(spec, RUNTIME_PROFILES.agent_gateway).map((issue) => issue.code),
    ['memory_scope_unsupported'],
  );
  assert.deepEqual(runtimeIssues(spec, withMastra.mastra), []);

  const noTools: AgentRuntimeProfile = {
    ...RUNTIME_PROFILES.agent_gateway,
    toolCalls: false,
    maxSteps: 4,
  };
  assert.deepEqual(
    runtimeIssues(bot(), noTools).map((issue) => issue.code),
    ['steps_unsupported', 'tools_unsupported'],
  );
});

test('привязка — отдельная строгая запись', () => {
  const ok = { bindingVersion: 1, solutionId: 'sol_1', agentVersion: 1, runtime: 'mastra' };
  assert.ok(runtimeBindingSchema.safeParse(ok).success);
  assert.equal(runtimeBindingSchema.safeParse({ ...ok, runtime: 'langchain' }).success, false);
  assert.equal(runtimeBindingSchema.safeParse({ ...ok, agentVersion: 0 }).success, false);
  assert.equal(runtimeBindingSchema.safeParse({ ...ok, spec: {} }).success, false);
});
