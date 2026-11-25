/**
 * Каталог шаблонов автоматизаций (docs/BUILDER_V1.md, раздел 4): код, как builder/templates.ts.
 * Шаблон — событие, шаги (действия platform/risk.ts), нужные подключения и возможности, тексты.
 * Риск и одобрение не задаются руками: их считает risk.ts по действиям шаблона.
 *
 * Переключатели у бота лежат в его JSON (`BotSettings.automations`), без миграции. Поле
 * `leadNotify` (шаг «заявка → менеджер», PR #80) читается как раньше, пока бот не сохранил
 * настройки в новом виде; при первой записи настроек оно переносится в `automations`.
 *
 * Шаблон, которому нужна недоступная возможность (discovery/capabilities.ts), виден с причиной,
 * но не включается. Выключение останавливает новые запуски; начатые шаги журнала доводятся или
 * сверяются по своим правилам.
 */

import { CAPABILITIES, type CapabilityId } from '../discovery/capabilities.js';
import {
  actionRisk,
  approvalRequirement,
  maxRisk,
  type ActionId,
  type ApprovalPolicy,
  type ApprovalRequirement,
  type RiskLevel,
} from '../platform/risk.js';
import type { Language } from '../types.js';
import type { BotSettings, LeadNotifySettings } from './types.js';

export const AUTOMATION_TEMPLATE_IDS = [
  'lead_to_sheet',
  'lead_to_manager',
  'daily_lead_summary',
] as const;
export type AutomationTemplateId = (typeof AUTOMATION_TEMPLATE_IDS)[number];

/** Событие, по которому запускается шаблон. */
export type AutomationEvent = 'lead.created' | 'schedule.daily';

/**
 * Что нужно подключить для шаблона (шаг 3 мастера):
 * - `external_service` — система данных; считается в лимите тарифа (billing/external-services.ts);
 * - `account` — то, что есть у аккаунта Ketner (почта, привязка Telegram к боту Ketner): не
 *   внешний сервис, места в тарифе не занимает.
 */
export interface AutomationConnection {
  id: 'google_sheets' | 'owner_email' | 'owner_telegram';
  kind: 'external_service' | 'account';
  /** Шаблон работает и без этого подключения (например, Telegram при включённой почте). */
  optional?: boolean;
}

export interface LeadToManagerOptions {
  email: boolean;
  telegram: boolean;
}

export interface AutomationTemplate {
  id: AutomationTemplateId;
  /** Версия шаблона: меняется, когда меняются шаги или их смысл. Сохраняется при включении. */
  version: number;
  event: AutomationEvent;
  /** Шаги по порядку — действия из словаря risk.ts. */
  actions: readonly ActionId[];
  connections: readonly AutomationConnection[];
  /** Возможности движка, без которых шаблон не запустить (например, планировщик). */
  requires: readonly CapabilityId[];
  title: Record<Language, string>;
  description: Record<Language, string>;
  /** Почему шаблон пока не включается — показывается, когда `available` ложно. */
  unavailableNote?: Record<Language, string>;
}

export const AUTOMATION_TEMPLATES: Readonly<Record<AutomationTemplateId, AutomationTemplate>> = {
  lead_to_sheet: {
    id: 'lead_to_sheet',
    version: 1,
    event: 'lead.created',
    actions: ['sheet.append_row'],
    connections: [{ id: 'google_sheets', kind: 'external_service' }],
    requires: [],
    title: { ru: 'Заявка → таблица', en: 'Lead → spreadsheet' },
    description: {
      ru: 'Каждая новая заявка бота — строкой в вашей Google Таблице.',
      en: 'Each new bot lead becomes a row in your Google Sheet.',
    },
  },
  lead_to_manager: {
    id: 'lead_to_manager',
    version: 1,
    event: 'lead.created',
    actions: ['owner.notify'],
    connections: [
      { id: 'owner_email', kind: 'account', optional: true },
      { id: 'owner_telegram', kind: 'account', optional: true },
    ],
    requires: [],
    title: { ru: 'Заявка → менеджер', en: 'Lead → manager' },
    description: {
      ru: 'О новой заявке — письмом и в Telegram (бот Ketner, если он привязан).',
      en: 'A new lead is sent by email and to Telegram (the Ketner bot, if linked).',
    },
  },
  daily_lead_summary: {
    id: 'daily_lead_summary',
    version: 1,
    event: 'schedule.daily',
    actions: ['owner.notify'],
    connections: [
      { id: 'owner_email', kind: 'account', optional: true },
      { id: 'owner_telegram', kind: 'account', optional: true },
    ],
    requires: ['scheduled_runs'],
    title: { ru: 'Сводка заявок за день', en: 'Daily lead summary' },
    description: {
      ru: 'Раз в сутки — сколько заявок пришло, имена и ссылка в кабинет.',
      en: 'Once a day: how many leads came in, their names and a link to your account.',
    },
    unavailableNote: {
      ru: 'Скоро: нужен запуск по расписанию, его в Ketner пока нет.',
      en: 'Coming soon: it needs scheduled runs, which Ketner does not have yet.',
    },
  },
};

export function isAutomationTemplateId(value: string): value is AutomationTemplateId {
  return Object.hasOwn(AUTOMATION_TEMPLATES, value);
}

/** Шаблон включается, только если у Ketner есть все нужные ему возможности. */
export function automationAvailable(template: AutomationTemplate): boolean {
  return template.requires.every((id) => CAPABILITIES[id].availability !== 'unavailable');
}

/** Риск шаблона — самый высокий из рисков его шагов. */
export function automationRisk(template: AutomationTemplate): RiskLevel {
  return maxRisk(template.actions.map(actionRisk));
}

const APPROVAL_RANK: Record<ApprovalRequirement, number> = { none: 0, required: 1, forbidden: 2 };

/**
 * Что нужно для включения — самое строгое требование среди шагов:
 * - `none` — включается сразу;
 * - `required` — только с подтверждением владельца («Подтверждаю» с текстом, что будет делаться);
 * - `forbidden` — не включается.
 */
export function automationApproval(
  template: AutomationTemplate,
  policy: ApprovalPolicy = {},
): ApprovalRequirement {
  return template.actions
    .map((id) => approvalRequirement(id, policy))
    .reduce<ApprovalRequirement>(
      (top, next) => (APPROVAL_RANK[next] > APPROVAL_RANK[top] ? next : top),
      'none',
    );
}

/** Внешние сервисы шаблона — то, что считается в лимите тарифа. */
export function automationExternalServices(template: AutomationTemplate): string[] {
  return template.connections
    .filter((connection) => connection.kind === 'external_service')
    .map((connection) => connection.id);
}

// ─── Переключатели бота ──────────────────────────────────────────────────────

export interface StoredAutomation {
  enabled: boolean;
  /** Версия шаблона на момент последнего включения или изменения. */
  version: number;
  /** Только у `lead_to_manager`: каналы уведомления. */
  options?: LeadToManagerOptions;
}

export type BotAutomations = Partial<Record<AutomationTemplateId, StoredAutomation>>;

export interface ResolvedAutomations {
  lead_to_sheet: StoredAutomation;
  lead_to_manager: StoredAutomation & { options: LeadToManagerOptions };
  daily_lead_summary: StoredAutomation;
}

/** Новые боты: заявка → таблица (когда таблица подключена) и заявка → менеджер, оба канала. */
export function newBotAutomations(): BotAutomations {
  return {
    lead_to_sheet: { enabled: true, version: AUTOMATION_TEMPLATES.lead_to_sheet.version },
    lead_to_manager: {
      enabled: true,
      version: AUTOMATION_TEMPLATES.lead_to_manager.version,
      options: { email: true, telegram: true },
    },
  };
}

/** Боты до шага «заявка → менеджер» (нет ни `automations`, ни `leadNotify`): только письмо. */
const LEGACY_MANAGER_OPTIONS: LeadToManagerOptions = { email: true, telegram: false };

function managerFromLeadNotify(value: LeadNotifySettings | undefined) {
  const options = value
    ? { email: value.email === true, telegram: value.telegram === true }
    : { ...LEGACY_MANAGER_OPTIONS };
  return {
    enabled: options.email || options.telegram,
    version: AUTOMATION_TEMPLATES.lead_to_manager.version,
    options,
  };
}

/**
 * Переключатели бота с учётом старых полей:
 * - `lead_to_sheet` — нет записи: включено (как до каталога: запись идёт, пока таблица подключена);
 * - `lead_to_manager` — нет записи: из `leadNotify`, а без него — только письмо;
 * - шаблон, который сейчас недоступен, выключен, что бы ни лежало в записи.
 */
export function automationsOf(
  bot: Pick<BotSettings, 'automations' | 'leadNotify'> | null | undefined,
): ResolvedAutomations {
  const stored = bot?.automations ?? {};
  const sheet = stored.lead_to_sheet;
  const manager = stored.lead_to_manager;
  const summary = stored.daily_lead_summary;
  return {
    lead_to_sheet: {
      enabled: sheet ? sheet.enabled === true : true,
      version: sheet?.version ?? AUTOMATION_TEMPLATES.lead_to_sheet.version,
    },
    lead_to_manager: manager
      ? {
          enabled: manager.enabled === true,
          version: manager.version,
          options: {
            email: manager.options?.email === true,
            telegram: manager.options?.telegram === true,
          },
        }
      : managerFromLeadNotify(bot?.leadNotify),
    daily_lead_summary: {
      enabled:
        summary?.enabled === true && automationAvailable(AUTOMATION_TEMPLATES.daily_lead_summary),
      version: summary?.version ?? AUTOMATION_TEMPLATES.daily_lead_summary.version,
    },
  };
}

/** Изменение переключателей из запроса владельца. */
export interface AutomationPatchEntry {
  enabled?: boolean;
  /** Подтверждение владельца для шаблона, которому нужно одобрение (`required`). */
  confirmed?: boolean;
  options?: Partial<LeadToManagerOptions>;
}

export type AutomationsPatch = Partial<Record<AutomationTemplateId, AutomationPatchEntry>>;

export type AutomationPatchError = {
  code: 'automation_unavailable' | 'automation_needs_confirmation' | 'automation_forbidden';
  template: AutomationTemplateId;
};

/**
 * Применить изменения к переключателям бота. Старое поле `leadNotify` из запроса (карточка
 * уведомлений) — то же, что `lead_to_manager` с этими каналами. Результат — полный набор записей
 * для сохранения вместо `leadNotify`.
 */
export function applyAutomationsPatch(
  bot: Pick<BotSettings, 'automations' | 'leadNotify'>,
  patch: { automations?: AutomationsPatch; leadNotify?: LeadNotifySettings },
  policy: ApprovalPolicy = {},
): { ok: true; automations: BotAutomations } | ({ ok: false } & AutomationPatchError) {
  const current = automationsOf(bot);
  const next: BotAutomations = {
    lead_to_sheet: { ...current.lead_to_sheet },
    lead_to_manager: {
      ...current.lead_to_manager,
      options: { ...current.lead_to_manager.options },
    },
    ...(bot.automations?.daily_lead_summary
      ? { daily_lead_summary: { ...current.daily_lead_summary } }
      : {}),
  };
  if (patch.leadNotify) {
    next.lead_to_manager = managerFromLeadNotify(patch.leadNotify);
  }
  for (const id of AUTOMATION_TEMPLATE_IDS) {
    const change = patch.automations?.[id];
    if (!change) continue;
    const template = AUTOMATION_TEMPLATES[id];
    const before = next[id] ?? current[id];
    const turningOn = change.enabled === true && !before.enabled;
    if (turningOn) {
      if (!automationAvailable(template)) {
        return { ok: false, code: 'automation_unavailable', template: id };
      }
      const approval = automationApproval(template, policy);
      if (approval === 'forbidden') {
        return { ok: false, code: 'automation_forbidden', template: id };
      }
      if (approval === 'required' && change.confirmed !== true) {
        return { ok: false, code: 'automation_needs_confirmation', template: id };
      }
    }
    const entry: StoredAutomation = {
      enabled: change.enabled ?? before.enabled,
      // Версия — та, с которой владелец включил или изменил шаблон.
      version: template.version,
    };
    if (id === 'lead_to_manager') {
      entry.options = { ...(before.options ?? current.lead_to_manager.options), ...change.options };
    }
    next[id] = entry;
  }
  return { ok: true, automations: next };
}

/** Каналы уведомления о заявке с учётом переключателя шаблона «заявка → менеджер». */
export function leadNotifyChannels(
  bot: Pick<BotSettings, 'automations' | 'leadNotify'> | null | undefined,
): LeadToManagerOptions {
  const manager = automationsOf(bot).lead_to_manager;
  return manager.enabled ? { ...manager.options } : { email: false, telegram: false };
}

/** Каталог с состоянием переключателей бота — для кабинета и будущего мастера. */
export function automationsView(bot: Pick<BotSettings, 'automations' | 'leadNotify'>) {
  const resolved = automationsOf(bot);
  return AUTOMATION_TEMPLATE_IDS.map((id) => {
    const template = AUTOMATION_TEMPLATES[id];
    const state = resolved[id];
    return {
      id,
      version: template.version,
      event: template.event,
      enabled: state.enabled,
      ...(state.options ? { options: state.options } : {}),
      available: automationAvailable(template),
      risk: automationRisk(template),
      approval: automationApproval(template),
      connections: template.connections,
    };
  });
}
