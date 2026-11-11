/**
 * Совместимость и политика исполнения (docs/DOMAIN_MODEL.md, раздел 7).
 *
 * Спецификации (SolutionSpec, AgentSpec) описывают решение и не знают об исполнителях. Этот слой
 * отвечает, можно ли исполнить решение здесь и сейчас:
 * - возможности поставщика процессов (какие действия и триггеры он умеет);
 * - лицензионные ограничения поставщика;
 * - развёртывание (поставщик и рантайм агентов подключены);
 * - нужные интеграции (реестр возможностей Ketner);
 * - одобрения при исполнении (словарь действий и политика одобрения).
 *
 * Смена исполнителя — новый профиль здесь; спецификации не меняются.
 */

import {
  CAPABILITIES,
  isCapabilityReleased,
  type CapabilityAvailability,
  type CapabilityId,
} from '../discovery/capabilities.js';
import { isAgentTemplate } from './agent-spec.js';
import type { SpecIssue } from './common.js';
import {
  ACTIONS,
  actionRisk,
  approvalRequirement,
  isActionId,
  type ActionId,
  type ApprovalPolicy,
  type ApprovalRequirement,
  type RiskLevel,
} from './risk.js';
import {
  DEFAULT_RUNTIME,
  RUNTIME_PROFILES,
  type AgentRuntimeId,
  type AgentRuntimeProfile,
} from './runtime-binding.js';
import {
  checkSolutionSpec,
  TRIGGER_KINDS,
  type SolutionSpec,
  type WorkflowComponent,
} from './solution-spec.js';

type TriggerKind = (typeof TRIGGER_KINDS)[number];

export type LicenseVerdict =
  | { status: 'allowed' }
  /** Похоже, разрешено, но нужно письменное подтверждение правообладателя (ключ подтверждения). */
  | { status: 'requires_confirmation'; confirmation: string; reason: string }
  /** Не разрешено бесплатной лицензией; нужна коммерческая. */
  | { status: 'requires_commercial_license'; reason: string };

/** Способ передать исполнителю учётные данные клиента. */
export type CredentialMode =
  'api_key' | 'service_account' | 'oauth_tokens_via_api' | 'oauth_provider_callback';

export interface WorkflowProviderProfile {
  id: string;
  label: string;
  /** Действия словаря, которые исполнитель может выполнить шагом процесса. */
  actions: readonly ActionId[];
  triggers: readonly TriggerKind[];
  credentialModes: readonly CredentialMode[];
  license(workflow: WorkflowComponent): LicenseVerdict;
}

/**
 * n8n Community Edition 2.46.6 (docs/N8N_DEPLOYMENT.md). Лицензия — по официальному FAQ n8n:
 * готовые процессы и процессы, собранные сотрудниками, — разрешены; копия фиксированного процесса
 * на клиента — нужна письменная проверка; логика, созданная или изменённая ИИ под клиента, — только
 * с коммерческой лицензией.
 *
 * Действия Ketner (знания, черновик, заявка, уведомление) процесс вызывает через API Ketner,
 * поэтому они доступны и из процесса. Деньги и договоры в разрешённых узлах не исполняются.
 *
 * Учётные данные: ключи и сервисные аккаунты — через публичный API. Токены OAuth, полученные Ketner,
 * — тоже через публичный API (`data.oauthTokenData`, поле объявлено в схеме типа `oAuth2Api`);
 * хранение и обновление токена самим n8n проверены опытом на 2.46.6 (docs/N8N_DEPLOYMENT.md, 2.4).
 * Собственный OAuth-колбэк n8n — внутренний путь редактора, в production не используется.
 */
export const N8N_COMMUNITY: WorkflowProviderProfile = {
  id: 'n8n_community',
  label: 'n8n Community Edition',
  actions: [
    'knowledge.search',
    'reply.draft',
    'lead.create',
    'owner.notify',
    'record.update',
    'record.update_significant',
    'record.delete',
    'message.send',
    'message.bulk_send',
  ],
  triggers: ['webhook', 'schedule', 'manual', 'channel_event'],
  credentialModes: ['api_key', 'service_account', 'oauth_tokens_via_api'],
  license(workflow) {
    if (workflow.logicOrigin === 'generated') {
      return {
        status: 'requires_commercial_license',
        reason:
          'AI-generated or AI-modified customer-specific workflow logic is not permitted under the n8n Sustainable Use License',
      };
    }
    if (workflow.instantiation === 'per_customer' && workflow.logicOrigin === 'catalog_template') {
      return {
        status: 'requires_confirmation',
        confirmation: 'n8n_per_customer_copy',
        reason:
          'Per-customer copies of a fixed staff-authored workflow need written confirmation from n8n',
      };
    }
    return { status: 'allowed' };
  },
};

export const WORKFLOW_PROVIDERS: Readonly<Record<string, WorkflowProviderProfile>> = {
  [N8N_COMMUNITY.id]: N8N_COMMUNITY,
};

export type IssueSeverity = 'blocker' | 'confirmation' | 'integration' | 'setup';

export interface CompatibilityIssue extends SpecIssue {
  severity: IssueSeverity;
}

export interface ApprovalItem {
  action: ActionId;
  risk: RiskLevel;
  requirement: ApprovalRequirement;
}

export type CompatibilityStatus =
  'ready' | 'needs_setup' | 'needs_integration' | 'needs_confirmation' | 'blocked';

export interface CompatibilityReport {
  status: CompatibilityStatus;
  issues: CompatibilityIssue[];
  approvals: ApprovalItem[];
}

export interface CompatibilityContext {
  /** Исполнитель процессов; null — не выбран. */
  workflowProvider: WorkflowProviderProfile | null;
  /** Исполнитель развёрнут и доступен. */
  workflowProviderDeployed: boolean;
  agentRuntime?: AgentRuntimeId;
  runtimeProfiles?: Readonly<Record<AgentRuntimeId, AgentRuntimeProfile>>;
  /** Доступность возможности для этого пользователя; по умолчанию — реестр Ketner. */
  capabilityAvailability?: (id: CapabilityId) => CapabilityAvailability;
  /** Полученные письменные подтверждения (ключи из LicenseVerdict). */
  confirmations?: ReadonlySet<string>;
  approvalPolicy?: ApprovalPolicy;
}

/** Доступность по реестру Ketner: невыпущенная возможность считается недоступной. */
export function registryAvailability(id: CapabilityId): CapabilityAvailability {
  return isCapabilityReleased(id) ? CAPABILITIES[id].availability : 'unavailable';
}

const SEVERITY_ORDER: Array<[IssueSeverity, CompatibilityStatus]> = [
  ['blocker', 'blocked'],
  ['confirmation', 'needs_confirmation'],
  ['integration', 'needs_integration'],
  ['setup', 'needs_setup'],
];

export function evaluateSolution(
  spec: SolutionSpec,
  ctx: CompatibilityContext,
): CompatibilityReport {
  const issues: CompatibilityIssue[] = [];
  const add = (severity: IssueSeverity, issue: SpecIssue) => issues.push({ severity, ...issue });
  const availability = ctx.capabilityAvailability ?? registryAvailability;

  // 1. Словари Ketner.
  for (const issue of checkSolutionSpec(spec)) add('blocker', issue);

  // 2. Возможности и интеграции: требования решения и требования его действий.
  const needed = new Map<CapabilityId, string>();
  spec.requires.forEach((id, i) => needed.set(id, `requires.${i}`));
  spec.integrations.forEach((item, i) =>
    needed.set(item.capability, `integrations.${i}.capability`),
  );
  spec.permissions.forEach((action, i) => {
    if (!isActionId(action)) return;
    for (const id of ACTIONS[action].requires)
      if (!needed.has(id)) needed.set(id, `permissions.${i}`);
  });
  for (const [id, path] of needed) {
    const state = availability(id);
    if (state === 'unavailable')
      add('blocker', {
        code: 'capability_unavailable',
        path,
        message: `${id} is not available in Ketner`,
      });
    else if (state === 'integration')
      add('integration', {
        code: 'integration_required',
        path,
        message: `${id} needs a connected service`,
      });
    else if (state === 'setup')
      add('setup', { code: 'setup_required', path, message: `${id} needs setup in Ketner` });
  }

  // 3. Процессы: исполнитель, его возможности и лицензия.
  spec.components.workflows.forEach((workflow, w) => {
    const base = `components.workflows.${w}`;
    const provider = ctx.workflowProvider;
    if (!provider) {
      add('blocker', {
        code: 'no_workflow_provider',
        path: base,
        message: 'No workflow provider is configured',
      });
      return;
    }
    if (!ctx.workflowProviderDeployed) {
      add('setup', {
        code: 'provider_not_deployed',
        path: base,
        message: `${provider.label} is not deployed`,
      });
    }
    if (!provider.triggers.includes(workflow.trigger.kind)) {
      add('blocker', {
        code: 'trigger_unsupported',
        path: `${base}.trigger.kind`,
        message: `${provider.label} cannot start a workflow from ${workflow.trigger.kind}`,
      });
    }
    workflow.steps.forEach((step, s) => {
      if (isActionId(step.action) && !provider.actions.includes(step.action)) {
        add('blocker', {
          code: 'action_unsupported_by_provider',
          path: `${base}.steps.${s}.action`,
          message: `${provider.label} cannot execute ${step.action}`,
        });
      }
    });
    const verdict = provider.license(workflow);
    if (verdict.status === 'requires_commercial_license') {
      add('blocker', { code: 'license_commercial_required', path: base, message: verdict.reason });
    } else if (
      verdict.status === 'requires_confirmation' &&
      !ctx.confirmations?.has(verdict.confirmation)
    ) {
      add('confirmation', {
        code: `license_confirmation:${verdict.confirmation}`,
        path: base,
        message: verdict.reason,
      });
    }
  });

  // 4. Агенты: шаблон — агент, рантайм подключён.
  const runtime = ctx.agentRuntime ?? DEFAULT_RUNTIME;
  const runtimeProfile = (ctx.runtimeProfiles ?? RUNTIME_PROFILES)[runtime];
  spec.components.agents.forEach((agent, a) => {
    const path = `components.agents.${a}`;
    if (!isAgentTemplate(agent.template)) {
      add('blocker', {
        code: 'not_an_agent_template',
        path: `${path}.template`,
        message: `${agent.template} is not an agent template`,
      });
    }
    if (!runtimeProfile.available) {
      add('setup', { code: 'runtime_unavailable', path, message: `${runtime} is not installed` });
    }
  });

  // 5. Одобрения при исполнении.
  const approvals: ApprovalItem[] = [];
  spec.permissions.forEach((action, i) => {
    if (!isActionId(action)) return;
    const requirement = approvalRequirement(action, ctx.approvalPolicy);
    approvals.push({ action, risk: actionRisk(action), requirement });
    if (requirement === 'forbidden') {
      add('blocker', {
        code: 'action_forbidden',
        path: `permissions.${i}`,
        message: `${action} is critical and has no verified process`,
      });
    }
  });

  const status =
    SEVERITY_ORDER.find(([severity]) => issues.some((issue) => issue.severity === severity))?.[1] ??
    'ready';
  return { status, issues, approvals };
}
