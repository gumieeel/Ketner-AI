/**
 * Привязка агента к рантайму (docs/DOMAIN_MODEL.md, раздел 5.4).
 *
 * AgentSpec описывает агента, а не то, чем он исполняется. Рантайм выбирается здесь: существующий
 * AgentGateway или Mastra (решение по Mastra — спайк T4.0). Оба рантайма вызывают модели только
 * через AIGateway; профиль рантайма описывает, какие возможности спецификации он поддерживает.
 */

import { z } from 'zod';
import type { AgentSpec } from './agent-spec.js';
import type { SpecIssue } from './common.js';

export const AGENT_RUNTIMES = ['agent_gateway', 'mastra'] as const;
export type AgentRuntimeId = (typeof AGENT_RUNTIMES)[number];

export interface AgentRuntimeProfile {
  id: AgentRuntimeId;
  /** Рантайм подключён в этой сборке. Mastra не установлена до решения T4.0. */
  available: boolean;
  memoryScopes: ReadonlyArray<AgentSpec['memoryPolicy']['scope']>;
  channels: ReadonlyArray<AgentSpec['channel']['kind']>;
  /** Вызывает ли рантайм действия (инструменты) по ходу ответа. */
  toolCalls: boolean;
  maxSteps: number;
}

export const RUNTIME_PROFILES: Readonly<Record<AgentRuntimeId, AgentRuntimeProfile>> = {
  agent_gateway: {
    id: 'agent_gateway',
    available: true,
    memoryScopes: ['none', 'conversation'],
    channels: ['ketner_chat', 'public_page', 'workflow'],
    toolCalls: true,
    maxSteps: 20,
  },
  mastra: {
    id: 'mastra',
    available: false,
    memoryScopes: ['none', 'conversation', 'task'],
    channels: ['ketner_chat', 'public_page', 'workflow'],
    toolCalls: true,
    maxSteps: 20,
  },
};

export const DEFAULT_RUNTIME: AgentRuntimeId = 'agent_gateway';

/** Хранимая (в будущем) привязка: какая версия какого агента каким рантаймом исполняется. */
export const runtimeBindingSchema = z.strictObject({
  bindingVersion: z.literal(1),
  solutionId: z.string().min(1).max(100),
  agentVersion: z.number().int().positive(),
  runtime: z.enum(AGENT_RUNTIMES),
});
export type RuntimeBinding = z.infer<typeof runtimeBindingSchema>;

/** Что в спецификации рантайм не поддерживает. Пустой список — можно привязать. */
export function runtimeIssues(spec: AgentSpec, profile: AgentRuntimeProfile): SpecIssue[] {
  const issues: SpecIssue[] = [];
  if (!profile.available) {
    issues.push({
      code: 'runtime_unavailable',
      path: 'runtime',
      message: `${profile.id} is not installed`,
    });
  }
  if (!profile.memoryScopes.includes(spec.memoryPolicy.scope)) {
    issues.push({
      code: 'memory_scope_unsupported',
      path: 'memoryPolicy.scope',
      message: `${profile.id} does not support ${spec.memoryPolicy.scope} memory`,
    });
  }
  if (!profile.channels.includes(spec.channel.kind)) {
    issues.push({
      code: 'channel_unsupported',
      path: 'channel.kind',
      message: `${profile.id} cannot serve ${spec.channel.kind}`,
    });
  }
  if (spec.limits.maxSteps > profile.maxSteps) {
    issues.push({
      code: 'steps_unsupported',
      path: 'limits.maxSteps',
      message: `${profile.id} allows up to ${profile.maxSteps} steps`,
    });
  }
  if (spec.limits.maxToolCalls > 0 && spec.allowedActions.length > 0 && !profile.toolCalls) {
    issues.push({
      code: 'tools_unsupported',
      path: 'allowedActions',
      message: `${profile.id} cannot call actions`,
    });
  }
  return issues;
}

export type BindResult = { ok: true; binding: RuntimeBinding } | { ok: false; issues: SpecIssue[] };

/**
 * Привязывает версию агента к рантайму. Спецификация не меняется: при смене рантайма меняется
 * только привязка.
 */
export function bindRuntime(
  spec: AgentSpec,
  target: { solutionId: string; agentVersion: number; runtime?: AgentRuntimeId },
  profiles: Readonly<Record<AgentRuntimeId, AgentRuntimeProfile>> = RUNTIME_PROFILES,
): BindResult {
  const runtime = target.runtime ?? DEFAULT_RUNTIME;
  const issues = runtimeIssues(spec, profiles[runtime]);
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    binding: runtimeBindingSchema.parse({
      bindingVersion: 1,
      solutionId: target.solutionId,
      agentVersion: target.agentVersion,
      runtime,
    }),
  };
}
