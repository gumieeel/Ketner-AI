/**
 * Жизненные циклы (docs/DOMAIN_MODEL.md, раздел 8): четыре отдельных автомата вместо одного
 * общего — решение, развёртывание агента, процесс, запуск процесса.
 *
 * Хранилище не меняется: состояния решения и развёртывания агента выводятся из существующих
 * записей (`solutions.status`, `active_version`, `current_version`, последний прогон тестов).
 * Колонка `solutions.status` по-прежнему хранит только `draft / active / paused`.
 * Автоматы процесса и запуска — для этапа 6; данных для них пока нет.
 */

import type { Solution, TestRun } from '../builder/types.js';

export class TransitionError extends Error {
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`${machine}: transition ${from} → ${to} is not allowed`);
    this.name = 'TransitionError';
  }
}

export interface StateMachine<S extends string> {
  name: string;
  states: readonly S[];
  can(from: S, to: S): boolean;
  /** Бросает TransitionError на запрещённый переход. */
  assert(from: S, to: S): void;
  next(from: S): readonly S[];
}

function machine<S extends string>(
  name: string,
  transitions: Readonly<Record<S, readonly S[]>>,
): StateMachine<S> {
  const states = Object.keys(transitions) as S[];
  return {
    name,
    states,
    can: (from, to) => transitions[from].includes(to),
    assert(from, to) {
      if (!transitions[from].includes(to)) throw new TransitionError(name, from, to);
    },
    next: (from) => transitions[from],
  };
}

// ---------------------------------------------------------------------------------------------
// 1. Решение: что задумано и одобрено владельцем
// ---------------------------------------------------------------------------------------------

export const SOLUTION_STATES = ['draft', 'approved', 'archived'] as const;
export type SolutionState = (typeof SOLUTION_STATES)[number];

/** draft — ещё ни разу не включалось; approved — владелец включал версию; archived — удалено. */
export const solutionMachine = machine<SolutionState>('solution', {
  draft: ['approved', 'archived'],
  approved: ['archived'],
  archived: [],
});

export function deriveSolutionState(solution: Pick<Solution, 'activeVersion'>): SolutionState {
  return solution.activeVersion === null ? 'draft' : 'approved';
}

// ---------------------------------------------------------------------------------------------
// 2. Развёртывание агента: что сейчас работает
// ---------------------------------------------------------------------------------------------

export const AGENT_DEPLOYMENT_STATES = [
  'not_deployed',
  'testing',
  'ready',
  'active',
  'paused',
  'failed',
] as const;
export type AgentDeploymentState = (typeof AGENT_DEPLOYMENT_STATES)[number];

export const agentDeploymentMachine = machine<AgentDeploymentState>('agent_deployment', {
  not_deployed: ['testing'],
  testing: ['ready', 'not_deployed'],
  ready: ['active', 'testing', 'not_deployed'],
  active: ['paused', 'failed', 'testing'],
  paused: ['active', 'testing'],
  failed: ['testing', 'paused'],
});

/** Значение колонки `solutions.status` для состояния развёртывания. */
export function legacyStatusOf(state: AgentDeploymentState): Solution['status'] {
  if (state === 'active' || state === 'failed') return 'active';
  if (state === 'paused') return 'paused';
  return 'draft';
}

/** Итог проверки кейса: вердикт пользователя важнее вердикта модели-судьи. */
export function caseVerdict(result: TestRun['results'][number]): 'pass' | 'fail' | null {
  if (result.status !== 'done') return null;
  return result.manual ?? result.judge?.verdict ?? null;
}

export interface DeploymentFacts {
  solution: Pick<Solution, 'status' | 'currentVersion' | 'activeVersion'>;
  /** Последний прогон тестов решения (любой версии) или null. */
  latestRun: Pick<TestRun, 'versionNumber' | 'casesHash' | 'status' | 'results'> | null;
  /** Отпечаток текущего набора кейсов. */
  casesHash: string;
}

/** Текущая версия проверена: прогон этой версии на этих кейсах завершён, все кейсы прошли. */
export function currentVersionPassed(facts: DeploymentFacts): boolean {
  const run = facts.latestRun;
  return (
    run !== null &&
    run.status === 'done' &&
    run.versionNumber === facts.solution.currentVersion &&
    run.casesHash === facts.casesHash &&
    run.results.length > 0 &&
    run.results.every((result) => caseVerdict(result) === 'pass')
  );
}

/**
 * Состояние развёртывания из существующих записей. `failed` из этих данных не выводится: оно
 * появится вместе с журналом исполнений (T1.4).
 */
export function deriveAgentDeploymentState(facts: DeploymentFacts): AgentDeploymentState {
  if (facts.solution.status === 'active') return 'active';
  if (facts.solution.status === 'paused') return 'paused';
  const run = facts.latestRun;
  if (run && run.status === 'running' && run.versionNumber === facts.solution.currentVersion)
    return 'testing';
  return currentVersionPassed(facts) ? 'ready' : 'not_deployed';
}

// ---------------------------------------------------------------------------------------------
// 3. Процесс (экземпляр у исполнителя)
// ---------------------------------------------------------------------------------------------

export const WORKFLOW_STATES = [
  'draft',
  'validated',
  'provisioned',
  'active',
  'inactive',
  'failed',
  'archived',
] as const;
export type WorkflowState = (typeof WORKFLOW_STATES)[number];

export const workflowMachine = machine<WorkflowState>('workflow', {
  draft: ['validated', 'archived'],
  validated: ['provisioned', 'draft', 'archived'],
  provisioned: ['active', 'failed', 'archived'],
  active: ['inactive', 'failed'],
  inactive: ['active', 'archived'],
  failed: ['provisioned', 'inactive', 'archived'],
  archived: [],
});

// ---------------------------------------------------------------------------------------------
// 4. Запуск процесса
// ---------------------------------------------------------------------------------------------

export const EXECUTION_STATES = [
  'queued',
  'waiting_approval',
  'running',
  'succeeded',
  'failed',
  'retrying',
  'cancelled',
  'timed_out',
] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

export const executionMachine = machine<ExecutionState>('workflow_execution', {
  queued: ['waiting_approval', 'running', 'cancelled'],
  waiting_approval: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'timed_out', 'cancelled'],
  failed: ['retrying'],
  timed_out: ['retrying'],
  retrying: ['running', 'cancelled'],
  succeeded: [],
  cancelled: [],
});

/** Повтор возможен, только пока не исчерпан потолок: бесконечных повторов нет. */
export function canRetry(state: ExecutionState, retriesDone: number, maxRetries: number): boolean {
  return executionMachine.can(state, 'retrying') && retriesDone < maxRetries;
}
