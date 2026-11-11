import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestResult, TestRun } from '../builder/types.js';
import {
  AGENT_DEPLOYMENT_STATES,
  agentDeploymentMachine,
  canRetry,
  deriveAgentDeploymentState,
  deriveSolutionState,
  executionMachine,
  legacyStatusOf,
  solutionMachine,
  TransitionError,
  workflowMachine,
  type DeploymentFacts,
} from './lifecycle.js';

const result = (overrides: Partial<TestResult> = {}): TestResult => ({
  caseId: 'c1',
  input: 'Сколько стоит?',
  criteria: ['Называет цену'],
  status: 'done',
  answer: '12 000 ₸',
  model: null,
  judge: { verdict: 'pass', notes: '', criteria: [] },
  manual: null,
  error: null,
  costUsd: 0,
  creditsUsd: 0,
  ...overrides,
});

const run = (overrides: Partial<TestRun> = {}): DeploymentFacts['latestRun'] => ({
  versionNumber: 2,
  casesHash: 'h1',
  status: 'done',
  results: [result()],
  ...overrides,
});

const facts = (overrides: Partial<DeploymentFacts> = {}): DeploymentFacts => ({
  solution: { status: 'draft', currentVersion: 2, activeVersion: null },
  latestRun: run(),
  casesHash: 'h1',
  ...overrides,
});

test('развёртывание агента из существующих записей', () => {
  assert.equal(deriveAgentDeploymentState(facts()), 'ready');
  assert.equal(deriveAgentDeploymentState(facts({ latestRun: null })), 'not_deployed');
  assert.equal(
    deriveAgentDeploymentState(facts({ latestRun: run({ status: 'running' }) })),
    'testing',
  );
  // Прогон старой версии или старого набора кейсов не считается.
  assert.equal(
    deriveAgentDeploymentState(facts({ latestRun: run({ versionNumber: 1 }) })),
    'not_deployed',
  );
  assert.equal(deriveAgentDeploymentState(facts({ casesHash: 'h2' })), 'not_deployed');
  // Провал кейса; ручной вердикт важнее судьи.
  assert.equal(
    deriveAgentDeploymentState(
      facts({
        latestRun: run({
          results: [result({ judge: { verdict: 'fail', notes: '', criteria: [] } })],
        }),
      }),
    ),
    'not_deployed',
  );
  assert.equal(
    deriveAgentDeploymentState(
      facts({
        latestRun: run({
          results: [
            result({ judge: { verdict: 'fail', notes: '', criteria: [] }, manual: 'pass' }),
          ],
        }),
      }),
    ),
    'ready',
  );
  assert.equal(
    deriveAgentDeploymentState(facts({ latestRun: run({ results: [] }) })),
    'not_deployed',
  );
  // Включён или на паузе — по колонке status.
  assert.equal(
    deriveAgentDeploymentState(
      facts({ solution: { status: 'active', currentVersion: 3, activeVersion: 2 } }),
    ),
    'active',
  );
  assert.equal(
    deriveAgentDeploymentState(
      facts({ solution: { status: 'paused', currentVersion: 2, activeVersion: 2 } }),
    ),
    'paused',
  );
});

test('состояние развёртывания сводится к колонке solutions.status', () => {
  const expected = {
    not_deployed: 'draft',
    testing: 'draft',
    ready: 'draft',
    active: 'active',
    paused: 'paused',
    failed: 'active',
  };
  for (const state of AGENT_DEPLOYMENT_STATES)
    assert.equal(legacyStatusOf(state), expected[state], state);
});

test('выведенное состояние согласовано с хранимым статусом', () => {
  for (const status of ['draft', 'active', 'paused'] as const) {
    const state = deriveAgentDeploymentState(
      facts({
        solution: { status, currentVersion: 2, activeVersion: status === 'draft' ? null : 2 },
      }),
    );
    assert.equal(legacyStatusOf(state), status);
  }
});

test('решение: черновик до первого включения', () => {
  assert.equal(deriveSolutionState({ activeVersion: null }), 'draft');
  assert.equal(deriveSolutionState({ activeVersion: 1 }), 'approved');
  assert.ok(solutionMachine.can('draft', 'approved'));
  assert.equal(solutionMachine.can('approved', 'draft'), false);
  assert.deepEqual(solutionMachine.next('archived'), []);
});

test('развёртывание агента: включить можно только проверенное', () => {
  assert.ok(agentDeploymentMachine.can('ready', 'active'));
  assert.equal(agentDeploymentMachine.can('not_deployed', 'active'), false);
  assert.equal(agentDeploymentMachine.can('testing', 'active'), false);
  assert.ok(agentDeploymentMachine.can('paused', 'active'));
  assert.throws(() => agentDeploymentMachine.assert('not_deployed', 'active'), TransitionError);
});

test('процесс и запуск — отдельные автоматы', () => {
  assert.ok(workflowMachine.can('validated', 'provisioned'));
  assert.equal(
    workflowMachine.can('draft', 'active'),
    false,
    'без проверки и создания у исполнителя',
  );
  assert.deepEqual(workflowMachine.next('archived'), []);

  assert.ok(executionMachine.can('queued', 'waiting_approval'));
  assert.ok(executionMachine.can('waiting_approval', 'running'));
  assert.equal(
    executionMachine.can('waiting_approval', 'succeeded'),
    false,
    'одобрение не завершает запуск',
  );
  assert.equal(executionMachine.can('succeeded', 'retrying'), false);
  assert.deepEqual(executionMachine.next('cancelled'), []);
});

test('повторы ограничены', () => {
  assert.ok(canRetry('failed', 0, 2));
  assert.ok(canRetry('timed_out', 1, 2));
  assert.equal(canRetry('failed', 2, 2), false);
  assert.equal(canRetry('failed', 0, 0), false);
  assert.equal(canRetry('succeeded', 0, 3), false);
});
