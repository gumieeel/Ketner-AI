/**
 * Схема процесса только для чтения (docs/BUILDER_V1.md, раздел 5): узлы и связи строятся из
 * SolutionSpec, а не рисуются руками. Одна функция даёт и схему, и её текстовое описание
 * (доступность: схема — `role="img"`, рядом — тот же список текстом).
 *
 * Узлы: триггер, компоненты (агенты, инструменты), события процессов, шаги процессов по порядку,
 * внешние сервисы из `integrations`. Связи: триггер → агент; агент → событие (для
 * `agent_calls_workflow`); событие → шаги; шаг → сервис, который нужен его действию.
 *
 * Раскладка детерминированная: уровень узла — длина самого длинного пути до него, порядок в уровне —
 * порядок добавления. Перетаскивать и соединять нельзя — это свободный редактор, он вне v1.
 * Счётчики за 7 дней на узлах (раздел 9) — позже, с оценкой экономии.
 */

import { CAPABILITIES, type CapabilityId } from '../discovery/capabilities.js';
import type { SolutionSpec, WorkflowComponent } from '../platform/solution-spec.js';
import { ACTIONS, actionRisk, isActionId, type RiskLevel } from '../platform/risk.js';
import type { Language } from '../types.js';
import {
  AUTOMATION_TEMPLATES,
  isAutomationTemplateId,
  type AutomationConnection,
  type AutomationTemplateId,
} from './automations.js';

export type DiagramNodeKind = 'trigger' | 'agent' | 'tool' | 'event' | 'step' | 'service';
/** ok — работает; attention — нужно действие владельца; paused — пауза (тариф); off — не подключено. */
export type DiagramState = 'ok' | 'attention' | 'paused' | 'off';

export interface DiagramNode {
  id: string;
  kind: DiagramNodeKind;
  label: string;
  /** Уровень риска действия шага (risk.ts). */
  risk?: RiskLevel;
  state?: DiagramState;
  stateLabel?: string;
  /** Колонка слева направо. */
  level: number;
  /** Строка внутри колонки. */
  row: number;
}

export interface DiagramEdge {
  from: string;
  to: string;
}

export interface Diagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /** Та же схема текстом, по строке на узел со связями. */
  description: string[];
}

/** Состояние подключения для схемы; `off` — канал выключен в настройках. */
export type ConnectionState =
  'connected' | 'not_connected' | 'reconnect_required' | 'sheet_missing' | 'tier_inactive' | 'off';

export type DiagramConnections = Partial<Record<AutomationConnection['id'], ConnectionState>>;

type Text = Record<Language, string>;

const TRIGGER_LABEL: Record<SolutionSpec['trigger']['kind'], Text> = {
  public_page: { ru: 'Клиент пишет агенту', en: 'A customer writes to the agent' },
  chat_message: { ru: 'Сообщение в чате', en: 'A chat message' },
  webhook: { ru: 'Вызов извне', en: 'An external call' },
  schedule: { ru: 'По расписанию', en: 'On schedule' },
  manual: { ru: 'Запуск вручную', en: 'Manual run' },
  channel_event: { ru: 'Событие', en: 'An event' },
};

const EVENT_LABEL: Record<(typeof AUTOMATION_TEMPLATES)[AutomationTemplateId]['event'], Text> = {
  'lead.created': { ru: 'Новая заявка', en: 'New lead' },
  'schedule.daily': { ru: 'Раз в сутки', en: 'Once a day' },
};

const STEP_LABEL: Record<AutomationTemplateId, Text> = {
  lead_to_sheet: { ru: 'Строка в таблицу', en: 'Row in the sheet' },
  lead_to_manager: { ru: 'Уведомление вам', en: 'Notice to you' },
  daily_lead_summary: { ru: 'Сводка заявок', en: 'Lead summary' },
};

const SERVICE_LABEL: Partial<Record<CapabilityId, Text>> = {
  spreadsheets_sync: { ru: 'Google Таблица', en: 'Google Sheet' },
};

const RISK_LABEL: Record<RiskLevel, Text> = {
  low: { ru: 'риск низкий', en: 'low risk' },
  medium: { ru: 'риск средний', en: 'medium risk' },
  high: { ru: 'риск высокий', en: 'high risk' },
  critical: { ru: 'риск критический', en: 'critical risk' },
};

const SERVICE_STATE: Record<ConnectionState, { state: DiagramState; label: Text }> = {
  connected: { state: 'ok', label: { ru: 'подключена', en: 'connected' } },
  not_connected: { state: 'off', label: { ru: 'не подключена', en: 'not connected' } },
  off: { state: 'off', label: { ru: 'не подключена', en: 'not connected' } },
  reconnect_required: {
    state: 'attention',
    label: { ru: 'нужно переподключить', en: 'reconnect needed' },
  },
  sheet_missing: {
    state: 'attention',
    label: { ru: 'таблица недоступна', en: 'sheet unavailable' },
  },
  tier_inactive: {
    state: 'paused',
    label: { ru: 'пауза: тариф не активен', en: 'paused: plan not active' },
  },
};

const CHANNEL_LABEL: Record<'owner_email' | 'owner_telegram', Text> = {
  owner_email: { ru: 'почта', en: 'email' },
  owner_telegram: { ru: 'Telegram', en: 'Telegram' },
};

function agentLabel(template: string, title: string, language: Language): string {
  if (template === 'customer_bot') {
    return language === 'en' ? `Agent "${title}"` : `Агент «${title}»`;
  }
  if (template === 'personal_assistant') {
    return language === 'en' ? `Assistant "${title}"` : `Помощник «${title}»`;
  }
  return language === 'en' ? `Agent "${title}"` : `Агент «${title}»`;
}

function templateOf(workflow: WorkflowComponent): AutomationTemplateId | null {
  const id = workflow.template?.id;
  return id && isAutomationTemplateId(id) ? id : null;
}

/** Состояние шага, которому нужны каналы аккаунта (почта, Telegram), — не внешние сервисы. */
function channelsState(
  template: AutomationTemplateId,
  connections: DiagramConnections,
  language: Language,
): Pick<DiagramNode, 'state' | 'stateLabel'> {
  const channels = AUTOMATION_TEMPLATES[template].connections.filter(
    (connection) => connection.kind === 'account',
  );
  if (channels.length === 0) return {};
  const ids = channels.map((channel) => channel.id as 'owner_email' | 'owner_telegram');
  const working = ids.filter((id) => connections[id] === 'connected');
  const broken = ids.filter(
    (id) =>
      connections[id] !== undefined && connections[id] !== 'connected' && connections[id] !== 'off',
  );
  if (working.length === 0) {
    return {
      state: 'attention',
      stateLabel: language === 'en' ? 'no channel works' : 'ни один канал не работает',
    };
  }
  const names = working.map((id) => CHANNEL_LABEL[id][language]).join(', ');
  const notLinked = broken.map((id) =>
    language === 'en'
      ? `${CHANNEL_LABEL[id].en} not linked`
      : `${CHANNEL_LABEL[id].ru} не привязан`,
  );
  return { state: 'ok', stateLabel: [names, ...notLinked].join('; ') };
}

export function diagramFromSpec(
  spec: SolutionSpec,
  connections: DiagramConnections,
  language: Language,
): Diagram {
  const nodes: Array<Omit<DiagramNode, 'level' | 'row'>> = [];
  const edges: DiagramEdge[] = [];
  const add = (node: Omit<DiagramNode, 'level' | 'row'>) => {
    if (!nodes.some((existing) => existing.id === node.id)) nodes.push(node);
    return node.id;
  };
  const link = (from: string, to: string) => {
    if (!edges.some((edge) => edge.from === from && edge.to === to)) edges.push({ from, to });
  };

  const { agents, tools, workflows } = spec.components;
  const usesTrigger = spec.strategy !== 'workflow';
  const trigger = usesTrigger
    ? add({ id: 'trigger', kind: 'trigger', label: TRIGGER_LABEL[spec.trigger.kind][language] })
    : null;
  const agentIds = agents.map((agent) =>
    add({
      id: `agent:${agent.key}`,
      kind: 'agent',
      label: agentLabel(agent.template, spec.title, language),
    }),
  );
  for (const tool of tools) {
    add({ id: `tool:${tool.key}`, kind: 'tool', label: tool.purpose });
  }
  if (trigger) {
    for (const id of nodes.filter((node) => node.kind === 'agent' || node.kind === 'tool')) {
      link(trigger, id.id);
    }
  }

  // Внешние сервисы — по возможностям из `integrations`; подключаются к шагам, чьё действие их
  // требует (risk.ts: `requires`).
  const services = new Map<CapabilityId, string>();
  const serviceNode = (capability: CapabilityId) => {
    const existing = services.get(capability);
    if (existing) return existing;
    const connection = capability === 'spreadsheets_sync' ? connections.google_sheets : undefined;
    const view = SERVICE_STATE[connection ?? 'not_connected'];
    const id = add({
      id: `service:${capability}`,
      kind: 'service',
      label: SERVICE_LABEL[capability]?.[language] ?? CAPABILITIES[capability].label[language],
      state: view.state,
      stateLabel: view.label[language],
    });
    services.set(capability, id);
    return id;
  };
  const integrations = new Set(spec.integrations.map((integration) => integration.capability));

  for (const workflow of workflows) {
    const template = templateOf(workflow);
    const event = template ? AUTOMATION_TEMPLATES[template].event : null;
    const eventId = add({
      id: event ? `event:${event}` : `event:${workflow.trigger.kind}:${workflow.key}`,
      kind: 'event',
      label: event
        ? EVENT_LABEL[event][language]
        : workflow.trigger.description || TRIGGER_LABEL[workflow.trigger.kind][language],
    });
    // Агент запускает процесс по своему событию (заявка); расписание — само себе начало.
    if (spec.strategy === 'agent_calls_workflow' && workflow.trigger.kind === 'channel_event') {
      for (const agentId of agentIds) link(agentId, eventId);
    }
    let previous = eventId;
    for (const step of workflow.steps) {
      const action = isActionId(step.action) ? step.action : null;
      const stepId = add({
        id: `step:${workflow.key}:${step.key}`,
        kind: 'step',
        label:
          template && workflow.steps.length === 1
            ? STEP_LABEL[template][language]
            : step.description,
        ...(action ? { risk: actionRisk(action) } : {}),
        ...(template ? channelsState(template, connections, language) : {}),
      });
      link(previous, stepId);
      previous = stepId;
      for (const capability of action ? ACTIONS[action].requires : []) {
        if (integrations.has(capability)) link(stepId, serviceNode(capability));
      }
    }
  }

  const laid = layout(nodes, edges);
  return { nodes: laid, edges, description: describe(laid, edges, language) };
}

/** Уровень — самый длинный путь от корня; узлы добавлены в порядке, где родитель раньше ребёнка. */
function layout(nodes: Array<Omit<DiagramNode, 'level' | 'row'>>, edges: DiagramEdge[]) {
  const level = new Map<string, number>();
  for (const node of nodes) {
    const parents = edges.filter((edge) => edge.to === node.id).map((edge) => edge.from);
    level.set(node.id, Math.max(-1, ...parents.map((id) => level.get(id) ?? 0)) + 1);
  }
  const rows = new Map<number, number>();
  return nodes.map((node) => {
    const column = level.get(node.id) ?? 0;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return { ...node, level: column, row };
  });
}

function nodeText(node: DiagramNode, language: Language): string {
  const notes = [node.stateLabel, node.risk ? RISK_LABEL[node.risk][language] : undefined].filter(
    Boolean,
  );
  return notes.length > 0 ? `${node.label} (${notes.join(', ')})` : node.label;
}

function describe(nodes: DiagramNode[], edges: DiagramEdge[], language: Language): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const lines: string[] = [];
  for (const node of nodes) {
    const targets = edges.filter((edge) => edge.from === node.id).map((edge) => byId.get(edge.to)!);
    const touched = targets.length > 0 || edges.some((edge) => edge.to === node.id);
    if (targets.length > 0) {
      lines.push(
        `${nodeText(node, language)} → ${targets.map((target) => nodeText(target, language)).join('; ')}`,
      );
    } else if (!touched) {
      lines.push(nodeText(node, language));
    }
  }
  return lines;
}
