/**
 * SolutionSpec — бизнес-задача и задуманное решение (docs/DOMAIN_MODEL.md, раздел 6).
 *
 * Спецификация не зависит от исполнителя: в ней нет n8n, его узлов, лицензий и режимов. Можно ли
 * исполнить решение конкретным исполнителем — решает слой совместимости (platform/compatibility.ts).
 * Та же спецификация остаётся валидной при смене исполнителя процессов.
 *
 * Цены здесь не хранятся: только ссылка на смету (Pricing Engine). Права и риск — из словаря
 * действий (platform/risk.ts).
 */

import { z } from 'zod';
import { CAPABILITY_IDS } from '../discovery/capabilities.js';
import { SOLUTION_TYPES } from '../pricing/catalog.js';
import {
  boundedText,
  dataShapeSchema,
  duplicateKeys,
  keySchema,
  requiredText,
  type SpecIssue,
} from './common.js';
import { isActionId } from './risk.js';

export const EXECUTION_STRATEGIES = [
  /** Только агент (помощник, бот). */
  'agent',
  /** Инструмент-операция (как учебный помощник). */
  'tool',
  /** Только процесс. */
  'workflow',
  /** Процесс вызывает агента. */
  'workflow_calls_agent',
  /** Агент запускает процесс. */
  'agent_calls_workflow',
] as const;
export type ExecutionStrategy = (typeof EXECUTION_STRATEGIES)[number];

export const TRIGGER_KINDS = [
  'chat_message',
  'public_page',
  'webhook',
  'schedule',
  'manual',
  'channel_event',
] as const;

export const triggerSchema = z.strictObject({
  kind: z.enum(TRIGGER_KINDS),
  description: boundedText(200),
});

/**
 * Шаг процесса на языке Ketner: какое действие из словаря выполняется и зачем. Это не узел
 * исполнителя: адаптер исполнителя переводит шаги в свой формат.
 */
export const workflowStepSchema = z.strictObject({
  key: keySchema,
  action: z.string().min(1).max(64),
  description: requiredText(300),
  onError: z.enum(['stop', 'retry', 'continue', 'notify_owner']),
});

export const workflowComponentSchema = z.strictObject({
  key: keySchema,
  purpose: requiredText(300),
  trigger: triggerSchema,
  steps: z.array(workflowStepSchema).min(1).max(30),
  /**
   * Кто задал логику процесса. Это факт о решении, а не правило конкретного исполнителя:
   * catalog_template — готовый шаблон каталога Ketner; staff_built — собран сотрудником под клиента;
   * generated — сгенерирован или изменён ИИ под клиента.
   */
  logicOrigin: z.enum(['catalog_template', 'staff_built', 'generated']),
  /** Шаблон каталога и его версия (для catalog_template). */
  template: z.strictObject({ id: keySchema, version: z.number().int().positive() }).nullable(),
  /** shared — один процесс на всех; per_customer — отдельный экземпляр на клиента. */
  instantiation: z.enum(['shared', 'per_customer']),
});

export const agentComponentSchema = z.strictObject({
  key: keySchema,
  /** Шаблон агента Builder (builder/templates.ts). */
  template: keySchema,
  purpose: requiredText(300),
});

export const toolComponentSchema = z.strictObject({
  key: keySchema,
  template: keySchema,
  purpose: requiredText(300),
});

export const integrationRequirementSchema = z.strictObject({
  capability: z.enum(CAPABILITY_IDS),
  purpose: requiredText(200),
  /** Кто подключает: клиент своим аккаунтом или Ketner своим. */
  connectedBy: z.enum(['customer', 'ketner']),
});

export const solutionSpecSchema = z
  .strictObject({
    specVersion: z.literal(1),
    title: requiredText(120),
    source: z
      .strictObject({ analysisId: z.string().min(1), opportunityId: z.string().min(1) })
      .nullable(),
    businessContext: boundedText(1000),
    problem: requiredText(1000),
    expectedOutcome: requiredText(1000),
    successCriteria: z.array(requiredText(200)).max(8),
    type: z.enum(SOLUTION_TYPES),
    strategy: z.enum(EXECUTION_STRATEGIES),
    trigger: triggerSchema,
    components: z.strictObject({
      agents: z.array(agentComponentSchema).max(3),
      workflows: z.array(workflowComponentSchema).max(3),
      tools: z.array(toolComponentSchema).max(5),
    }),
    requires: z.array(z.enum(CAPABILITY_IDS)).max(20),
    integrations: z.array(integrationRequirementSchema).max(10),
    knowledgeSources: z
      .array(
        z.strictObject({
          kind: z.enum(['site', 'document', 'inline', 'corrections']),
          ref: boundedText(200),
        }),
      )
      .max(10),
    input: dataShapeSchema,
    output: dataShapeSchema,
    /** Действия, которые решение выполняет (словарь platform/risk.ts). */
    permissions: z.array(z.string().min(1).max(64)).max(30),
    failureHandling: z.strictObject({
      onError: z.enum(['notify_owner', 'retry_then_notify', 'stop']),
      maxRetries: z.number().int().min(0).max(3),
    }),
    testing: z.strictObject({
      minCases: z.number().int().min(1).max(20),
      kinds: z
        .array(z.enum(['typical', 'unknown', 'escalation', 'injection', 'failure']))
        .min(1)
        .max(5),
    }),
    effort: z.enum(['low', 'medium', 'high']),
    /** Смета Pricing Engine; цен в спецификации нет. */
    estimateId: z.string().min(1).nullable(),
    assumptions: z.array(requiredText(300)).max(10),
    unknowns: z.array(requiredText(300)).max(10),
  })
  .superRefine((spec, ctx) => {
    const { agents, workflows, tools } = spec.components;
    const expected: Record<
      ExecutionStrategy,
      { agents: boolean; workflows: boolean; tools: boolean }
    > = {
      agent: { agents: true, workflows: false, tools: false },
      tool: { agents: false, workflows: false, tools: true },
      workflow: { agents: false, workflows: true, tools: false },
      workflow_calls_agent: { agents: true, workflows: true, tools: false },
      agent_calls_workflow: { agents: true, workflows: true, tools: false },
    };
    const want = expected[spec.strategy];
    const have = {
      agents: agents.length > 0,
      workflows: workflows.length > 0,
      tools: tools.length > 0,
    };
    for (const part of ['agents', 'workflows', 'tools'] as const) {
      if (want[part] !== have[part]) {
        ctx.addIssue({
          code: 'custom',
          path: ['components', part],
          message: `strategy ${spec.strategy} ${want[part] ? 'needs' : 'does not use'} ${part}`,
        });
      }
    }
    workflows.forEach((workflow, index) => {
      if ((workflow.logicOrigin === 'catalog_template') !== (workflow.template !== null)) {
        ctx.addIssue({
          code: 'custom',
          path: ['components', 'workflows', index, 'template'],
          message: 'a catalog template workflow references its template, and only it does',
        });
      }
      const stepDuplicates = duplicateKeys(workflow.steps);
      if (stepDuplicates.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['components', 'workflows', index, 'steps'],
          message: `step keys repeat: ${stepDuplicates.join(', ')}`,
        });
      }
    });
    const keyDuplicates = duplicateKeys([...agents, ...workflows, ...tools]);
    if (keyDuplicates.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['components'],
        message: `component keys repeat: ${keyDuplicates.join(', ')}`,
      });
    }
  });

export type SolutionSpec = z.infer<typeof solutionSpecSchema>;
export type WorkflowComponent = SolutionSpec['components']['workflows'][number];

/**
 * Проверки по словарям Ketner (не по исполнителю): действия известны, действия шагов процессов
 * входят в права решения.
 */
export function checkSolutionSpec(spec: SolutionSpec): SpecIssue[] {
  const issues: SpecIssue[] = [];
  spec.permissions.forEach((action, index) => {
    if (!isActionId(action)) {
      issues.push({
        code: 'unknown_action',
        path: `permissions.${index}`,
        message: `Unknown action: ${action}`,
      });
    }
  });
  spec.components.workflows.forEach((workflow, w) => {
    workflow.steps.forEach((step, s) => {
      const path = `components.workflows.${w}.steps.${s}.action`;
      if (!isActionId(step.action)) {
        issues.push({ code: 'unknown_action', path, message: `Unknown action: ${step.action}` });
      } else if (!spec.permissions.includes(step.action)) {
        issues.push({
          code: 'action_not_permitted',
          path,
          message: `${step.action} is not in permissions`,
        });
      }
    });
  });
  return issues;
}
