/**
 * SolutionSpec бота для клиентов, выведенный из его настроек (docs/BUILDER_V1.md, раздел 1):
 * бот — агент на странице и в виджете; включённые шаблоны автоматизаций (builder/automations.ts) —
 * процессы, которые он запускает по событию «заявка». Ничего не хранится: спецификация строится
 * из `solutions.bot` при каждом запросе, по ней — схема (platform/diagram.ts).
 *
 * Тексты спецификации — служебные, на русском: владельцу показываются подписи схемы, а не они.
 */

import type { SolutionSpec, WorkflowComponent } from '../platform/solution-spec.js';
import { TEXT_SHAPE } from '../platform/common.js';
import type { ActionId } from '../platform/risk.js';
import {
  AUTOMATION_TEMPLATE_IDS,
  AUTOMATION_TEMPLATES,
  automationAvailable,
  automationsOf,
  type AutomationTemplate,
} from './automations.js';
import type { Solution } from './types.js';

const TRIGGER_BY_EVENT: Record<AutomationTemplate['event'], WorkflowComponent['trigger']> = {
  'lead.created': { kind: 'channel_event', description: 'Новая заявка бота' },
  'schedule.daily': { kind: 'schedule', description: 'Раз в сутки' },
};

/** Как шаг ведёт себя при сбое: запись в таблицу повторяется журналом, уведомление — нет. */
const ON_ERROR: Partial<Record<ActionId, WorkflowComponent['steps'][number]['onError']>> = {
  'sheet.append_row': 'retry',
  'owner.notify': 'continue',
};

function workflowOf(template: AutomationTemplate): WorkflowComponent {
  return {
    key: template.id,
    purpose: template.description.ru,
    trigger: TRIGGER_BY_EVENT[template.event],
    steps: template.actions.map((action, index) => ({
      key: `step-${index + 1}`,
      action,
      description: template.title.ru,
      onError: ON_ERROR[action] ?? 'notify_owner',
    })),
    logicOrigin: 'catalog_template',
    template: { id: template.id, version: template.version },
    instantiation: 'per_customer',
  };
}

export function botSolutionSpec(solution: Pick<Solution, 'name' | 'bot' | 'source'>): SolutionSpec {
  const resolved = automationsOf(solution.bot);
  const enabled = AUTOMATION_TEMPLATE_IDS.map((id) => AUTOMATION_TEMPLATES[id]).filter(
    (template) => resolved[template.id].enabled && automationAvailable(template),
  );
  const workflows = enabled.map(workflowOf);
  const actions = enabled.flatMap((template) => template.actions);
  const sheet = enabled.some((template) => template.id === 'lead_to_sheet');
  const title = solution.name.slice(0, 120) || 'Бот';
  return {
    specVersion: 1,
    title,
    source: solution.source
      ? { analysisId: solution.source.analysisId, opportunityId: solution.source.opportunityId }
      : null,
    businessContext: '',
    problem: solution.source?.title?.slice(0, 1000) || 'Отвечать клиентам и собирать заявки',
    expectedOutcome: 'Клиенты получают ответ сразу, заявки доходят до владельца',
    successCriteria: [],
    type: 'assistant',
    strategy: workflows.length > 0 ? 'agent_calls_workflow' : 'agent',
    trigger: {
      kind: 'public_page',
      description: 'Посетитель пишет боту на странице или в виджете',
    },
    components: {
      agents: [
        { key: 'bot', template: 'customer_bot', purpose: 'Отвечает клиентам, принимает заявки' },
      ],
      workflows,
      tools: [],
    },
    requires: [
      'text_generation',
      'customer_bot_page',
      ...(sheet ? (['spreadsheets_sync'] as const) : []),
    ],
    integrations: sheet
      ? [
          {
            capability: 'spreadsheets_sync',
            purpose: 'Строки заявок в Google Таблицу владельца',
            connectedBy: 'customer',
          },
        ]
      : [],
    knowledgeSources: [],
    input: TEXT_SHAPE,
    output: TEXT_SHAPE,
    permissions: [...new Set<string>(['reply.send_in_session', 'lead.create', ...actions])],
    failureHandling: { onError: 'notify_owner', maxRetries: 3 },
    testing: { minCases: 3, kinds: ['typical', 'unknown', 'escalation'] },
    effort: 'low',
    estimateId: null,
    assumptions: [],
    unknowns: [],
  };
}
