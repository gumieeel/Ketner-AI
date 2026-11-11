/**
 * Риск действий и требования одобрения (docs/DOMAIN_MODEL.md, раздел 4).
 *
 * Риск выводится из последствий действия: что оно меняет, кого затрагивает, можно ли его
 * отменить. Требование одобрения — отдельное правило поверх риска: оно учитывает настройки
 * владельца, но не может ослабить обязательные ограничения. Ни риск, ни одобрение не задаёт
 * модель: их считает этот код.
 */

import type { CapabilityId } from '../discovery/capabilities.js';

export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export function riskRank(level: RiskLevel): number {
  return RISK_LEVELS.indexOf(level);
}

export function maxRisk(levels: readonly RiskLevel[]): RiskLevel {
  return levels.reduce<RiskLevel>(
    (top, level) => (riskRank(level) > riskRank(top) ? level : top),
    'low',
  );
}

/** Последствия действия — единственный вход классификации риска. */
export interface ActionConsequences {
  /**
   * read — только чтение; draft — черновик или запись внутри Ketner; write — изменение данных во
   * внешней системе; send — сообщение людям; delete — удаление; financial — деньги, цены, возвраты;
   * legal — договоры и юридически значимые действия.
   */
  effect: 'read' | 'draft' | 'write' | 'send' | 'delete' | 'financial' | 'legal';
  /** internal — остаётся в Ketner (владелец видит); external — уходит во внешнюю систему или людям. */
  reach: 'internal' | 'external';
  /** Скольких людей или записей касается одно действие. */
  audience: 'none' | 'single' | 'bulk';
  /** Можно ли отменить без ущерба. */
  reversible: boolean;
  /** routine — обычная операция; significant — заметно влияет на клиента или бизнес. */
  impact: 'routine' | 'significant';
}

/**
 * Риск по последствиям:
 * - чтение, черновики и записи внутри Ketner — LOW;
 * - обычное обратимое изменение одной записи во внешней системе — LOW, значимое или необратимое — MEDIUM;
 * - сообщение одному человеку — MEDIUM, внутреннее уведомление владельцу — LOW, рассылка — HIGH;
 * - удаление: обратимое — HIGH, необратимое — CRITICAL;
 * - деньги и юридически значимые действия: обратимые — HIGH, необратимые — CRITICAL.
 */
export function classifyRisk(c: ActionConsequences): RiskLevel {
  switch (c.effect) {
    case 'read':
      return c.audience === 'bulk' && c.reach === 'external' ? 'medium' : 'low';
    case 'draft':
      return 'low';
    case 'write':
      if (c.audience === 'bulk') return 'high';
      if (c.reach === 'internal') return 'low';
      return c.reversible && c.impact === 'routine' ? 'low' : 'medium';
    case 'send':
      if (c.audience === 'bulk') return 'high';
      if (c.reach === 'internal') return 'low';
      return c.impact === 'significant' ? 'high' : 'medium';
    case 'delete':
      return c.reversible ? 'high' : 'critical';
    case 'financial':
    case 'legal':
      return c.reversible ? 'high' : 'critical';
  }
}

export interface ActionDefinition {
  id: string;
  consequences: ActionConsequences;
  /** Возможности Ketner, без которых действие не выполнить (реестр discovery/capabilities.ts). */
  requires: readonly CapabilityId[];
  description: string;
}

/**
 * Словарь действий Ketner. Он не зависит от исполнителя: процесс n8n, свой исполнитель или агент
 * выполняют одни и те же действия. Новое действие — новая запись здесь и в тестах.
 */
export const ACTIONS = {
  'knowledge.search': {
    id: 'knowledge.search',
    consequences: {
      effect: 'read',
      reach: 'internal',
      audience: 'none',
      reversible: true,
      impact: 'routine',
    },
    requires: [],
    description: 'Поиск в знаниях владельца',
  },
  'reply.draft': {
    id: 'reply.draft',
    consequences: {
      effect: 'draft',
      reach: 'internal',
      audience: 'none',
      reversible: true,
      impact: 'routine',
    },
    requires: ['text_generation'],
    description: 'Черновик ответа или документа',
  },
  'reply.send_in_session': {
    id: 'reply.send_in_session',
    // Ответ в открытом диалоге с тем, кто спросил (чат бота на странице Ketner).
    consequences: {
      effect: 'send',
      reach: 'external',
      audience: 'single',
      reversible: false,
      impact: 'routine',
    },
    requires: ['text_generation'],
    description: 'Ответ собеседнику в открытом диалоге',
  },
  'lead.create': {
    id: 'lead.create',
    consequences: {
      effect: 'write',
      reach: 'internal',
      audience: 'single',
      reversible: true,
      impact: 'routine',
    },
    requires: [],
    description: 'Заявка в кабинете владельца',
  },
  'owner.notify': {
    id: 'owner.notify',
    consequences: {
      effect: 'send',
      reach: 'internal',
      audience: 'single',
      reversible: false,
      impact: 'routine',
    },
    requires: [],
    description: 'Уведомление владельцу',
  },
  'record.update': {
    id: 'record.update',
    consequences: {
      effect: 'write',
      reach: 'external',
      audience: 'single',
      reversible: true,
      impact: 'routine',
    },
    requires: ['crm'],
    description: 'Обычное изменение одной записи во внешней системе (CRM, таблица)',
  },
  'record.update_significant': {
    id: 'record.update_significant',
    consequences: {
      effect: 'write',
      reach: 'external',
      audience: 'single',
      reversible: false,
      impact: 'significant',
    },
    requires: ['crm'],
    description: 'Значимое или необратимое изменение записи (статус сделки, сумма)',
  },
  'message.send': {
    id: 'message.send',
    consequences: {
      effect: 'send',
      reach: 'external',
      audience: 'single',
      reversible: false,
      impact: 'routine',
    },
    requires: ['messengers'],
    description: 'Сообщение одному клиенту в подключённый канал',
  },
  'message.bulk_send': {
    id: 'message.bulk_send',
    consequences: {
      effect: 'send',
      reach: 'external',
      audience: 'bulk',
      reversible: false,
      impact: 'significant',
    },
    requires: ['messengers'],
    description: 'Рассылка группе клиентов',
  },
  'record.delete': {
    id: 'record.delete',
    consequences: {
      effect: 'delete',
      reach: 'external',
      audience: 'single',
      reversible: false,
      impact: 'significant',
    },
    requires: ['crm'],
    description: 'Удаление записи во внешней системе',
  },
  'payment.refund': {
    id: 'payment.refund',
    consequences: {
      effect: 'financial',
      reach: 'external',
      audience: 'single',
      reversible: false,
      impact: 'significant',
    },
    requires: ['external_actions'],
    description: 'Возврат денег',
  },
  'price.change': {
    id: 'price.change',
    consequences: {
      effect: 'financial',
      reach: 'external',
      audience: 'bulk',
      reversible: true,
      impact: 'significant',
    },
    requires: ['external_actions'],
    description: 'Изменение цен',
  },
  'contract.sign': {
    id: 'contract.sign',
    consequences: {
      effect: 'legal',
      reach: 'external',
      audience: 'single',
      reversible: false,
      impact: 'significant',
    },
    requires: ['external_actions'],
    description: 'Подписание договора',
  },
} as const satisfies Record<string, ActionDefinition>;

export type ActionId = keyof typeof ACTIONS;
export const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];

export function isActionId(value: string): value is ActionId {
  return Object.hasOwn(ACTIONS, value);
}

export function actionRisk(id: ActionId): RiskLevel {
  return classifyRisk(ACTIONS[id].consequences);
}

/**
 * Требование одобрения:
 * - none — выполняется сразу;
 * - required — только после одобрения человеком в Ketner;
 * - forbidden — не выполняется.
 */
export type ApprovalRequirement = 'none' | 'required' | 'forbidden';

/** Настройки одобрения владельца или решения. */
export interface ApprovalPolicy {
  /** Действия, для которых владелец сам включил одобрение каждого раза (только ужесточает). */
  alwaysApprove?: readonly string[];
  /**
   * Заранее выданные разрешения: владелец один раз разрешил действие (например, отвечать клиентам
   * от имени бизнеса). Без такого разрешения внешнее действие риска MEDIUM требует одобрения.
   */
  standingPermissions?: readonly string[];
  /**
   * Действия риска CRITICAL, для которых есть отдельный проверенный процесс (id процесса).
   * Только тогда CRITICAL выполняется — и всегда с одобрением.
   */
  verifiedCriticalProcesses?: Readonly<Record<string, string>>;
}

/**
 * Одобрение по риску и настройкам:
 * - LOW — сразу, если владелец не включил одобрение сам;
 * - MEDIUM внутри Ketner — так же; MEDIUM наружу (сообщение клиенту, значимое изменение записи) —
 *   сразу только при заранее выданном разрешении, иначе одобрение каждого раза;
 * - HIGH — всегда одобрение, настройками не отключается;
 * - CRITICAL — запрещено без проверенного процесса, с ним — только с одобрением.
 * Включённое владельцем «одобрять всегда» сильнее заранее выданного разрешения.
 */
export function approvalRequirement(
  id: ActionId,
  policy: ApprovalPolicy = {},
): ApprovalRequirement {
  const risk = actionRisk(id);
  if (risk === 'critical') {
    return policy.verifiedCriticalProcesses?.[id] ? 'required' : 'forbidden';
  }
  if (risk === 'high') return 'required';
  if (policy.alwaysApprove?.includes(id)) return 'required';
  if (risk === 'medium' && ACTIONS[id].consequences.reach === 'external') {
    return policy.standingPermissions?.includes(id) ? 'none' : 'required';
  }
  return 'none';
}
