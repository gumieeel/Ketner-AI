/**
 * AgentSpec — описание агента как такового (docs/DOMAIN_MODEL.md, раздел 5).
 *
 * Спецификация не говорит, чем агент исполняется: рантайм (существующий AgentGateway или Mastra)
 * выбирается отдельно — platform/runtime-binding.ts. Одна и та же спецификация исполняется любым
 * подходящим рантаймом.
 *
 * Хранилище на этом этапе не меняется: спецификация выводится из существующих настроек
 * (`AssistantConfig` версии и `BotSettings` решения) и переводится обратно без потерь.
 */

import { z } from 'zod';
import { SLUG_PATTERN } from '../builder/bot-prompt.js';
import { BOT_HISTORY, BOT_LIMITS, BOT_REPLY_CAP_USD } from '../builder/bot-service.js';
import { LIMITS, toneSchema } from '../builder/schemas.js';
import type { AssistantConfig, BotSettings } from '../builder/types.js';
import { toCredits } from '../services/entitlement.js';
import {
  boundedText,
  dataShapeSchema,
  languageSchema,
  requiredText,
  TEXT_SHAPE,
  type SpecIssue,
} from './common.js';
import {
  actionRisk,
  ACTIONS,
  approvalRequirement,
  isActionId,
  type ApprovalPolicy,
} from './risk.js';

/** Предел ответа бота в кредитах — из той же константы, что списывает бот. */
/** Самый длинный срок прогона агента (`limits.timeoutMs`); от него — порог reaper'а. */
export const AGENT_SPEC_MAX_TIMEOUT_MS = 120_000;

export const BOT_REPLY_CAP_CREDITS = toCredits(BOT_REPLY_CAP_USD);

const exampleSchema = z.strictObject({
  input: requiredText(LIMITS.exampleChars),
  output: requiredText(LIMITS.exampleChars),
});

const correctionSchema = z.strictObject({
  question: requiredText(BOT_LIMITS.correctionChars),
  answer: requiredText(BOT_LIMITS.correctionChars),
});

export const escalationRuleSchema = z.strictObject({
  when: z.enum(['unknown_answer', 'customer_asks_human', 'credits_exhausted', 'risk_high']),
  action: z.enum(['offer_contact_form', 'notify_owner', 'stop']),
});

export const channelSchema = z.discriminatedUnion('kind', [
  /** Помощник в чате Ketner у самого владельца. */
  z.strictObject({ kind: z.literal('ketner_chat') }),
  /** Публичная страница бота ketner.org/b/<slug> и виджет. */
  z.strictObject({
    kind: z.literal('public_page'),
    slug: z.string().regex(SLUG_PATTERN),
    greeting: boundedText(BOT_LIMITS.greeting),
    quickReplies: z.array(requiredText(BOT_LIMITS.quickReply)).max(BOT_LIMITS.quickReplies),
  }),
  /** Агента вызывает процесс (через Ketner). */
  z.strictObject({ kind: z.literal('workflow') }),
]);

export const agentSpecSchema = z.strictObject({
  specVersion: z.literal(1),
  name: requiredText(LIMITS.name),
  /** Кто агент и для чего. У существующих помощников может быть пустым. */
  role: boundedText(LIMITS.purpose),
  objectives: z.array(requiredText(200)).max(5),
  instructions: boundedText(LIMITS.instructions),
  tone: toneSchema,
  language: languageSchema,
  knowledge: z.strictObject({
    inline: boundedText(LIMITS.knowledge),
    examples: z.array(exampleSchema).max(LIMITS.examples),
    corrections: z.array(correctionSchema).max(BOT_LIMITS.corrections),
    /** Документы знаний владельца (этап 3). */
    documents: z.array(z.string().min(1).max(64)).max(50),
  }),
  /** Id действий из словаря platform/risk.ts. Риск и одобрение — из кода, не отсюда. */
  allowedActions: z.array(z.string().min(1).max(64)).max(20),
  restrictions: z.array(requiredText(LIMITS.restrictionChars)).max(LIMITS.restrictions),
  escalation: z.array(escalationRuleSchema).max(10),
  input: dataShapeSchema,
  output: dataShapeSchema,
  modelPolicy: z.strictObject({
    /** Модель выбирает AIGateway (Auto), как сейчас. */
    selection: z.literal('auto'),
    maxCreditsPerReply: z.number().int().positive().max(1_000).nullable(),
  }),
  memoryPolicy: z.strictObject({
    scope: z.enum(['none', 'conversation', 'task']),
    maxMessages: z.number().int().min(0).max(50),
  }),
  limits: z.strictObject({
    maxSteps: z.number().int().min(1).max(20),
    maxToolCalls: z.number().int().min(0).max(20),
    timeoutMs: z.number().int().min(1_000).max(AGENT_SPEC_MAX_TIMEOUT_MS),
    /** Суточный потолок расхода; null — без отдельного потолка (личный помощник). */
    dailyCapCredits: z
      .number()
      .int()
      .min(BOT_LIMITS.dailyCapMin)
      .max(BOT_LIMITS.dailyCapMax)
      .nullable(),
  }),
  channel: channelSchema,
  testing: z.strictObject({
    minCases: z.number().int().min(0).max(20),
    requiredKinds: z.array(z.enum(['typical', 'unknown', 'escalation', 'injection'])).max(4),
  }),
});

export type AgentSpec = z.infer<typeof agentSpecSchema>;

/**
 * Проверки кодом после схемы: действия из словаря, запрещённые действия, согласованность лимитов
 * и канала. Пустой список — спецификация готова к привязке к рантайму.
 */
export function checkAgentSpec(spec: AgentSpec, policy: ApprovalPolicy = {}): SpecIssue[] {
  const issues: SpecIssue[] = [];
  spec.allowedActions.forEach((action, index) => {
    const path = `allowedActions.${index}`;
    if (!isActionId(action)) {
      issues.push({ code: 'unknown_action', path, message: `Unknown action: ${action}` });
    } else if (approvalRequirement(action, policy) === 'forbidden') {
      issues.push({
        code: 'forbidden_action',
        path,
        message: `${action} is ${actionRisk(action)} risk and has no verified process`,
      });
    }
  });
  if (new Set(spec.allowedActions).size !== spec.allowedActions.length) {
    issues.push({ code: 'duplicate_action', path: 'allowedActions', message: 'Actions repeat' });
  }
  if (spec.limits.maxToolCalls > spec.limits.maxSteps * 4) {
    issues.push({
      code: 'limits_inconsistent',
      path: 'limits.maxToolCalls',
      message: 'Too many tool calls for the step limit',
    });
  }
  if (
    spec.escalation.some((rule) => rule.action === 'offer_contact_form') &&
    spec.channel.kind !== 'public_page'
  ) {
    issues.push({
      code: 'escalation_channel',
      path: 'escalation',
      message: 'A contact form exists only on the public bot page',
    });
  }
  if (
    spec.escalation.some((rule) => rule.action === 'offer_contact_form') &&
    !spec.allowedActions.includes('lead.create')
  ) {
    issues.push({
      code: 'escalation_action',
      path: 'allowedActions',
      message: 'The contact form needs lead.create',
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------------------------
// Совместимость с существующими настройками
// ---------------------------------------------------------------------------------------------

/** Шаблоны Builder, которые являются агентами. `study_assistant` — инструмент, не агент. */
export const AGENT_TEMPLATES = ['personal_assistant', 'customer_bot'] as const;
export type AgentTemplate = (typeof AGENT_TEMPLATES)[number];

export function isAgentTemplate(template: string): template is AgentTemplate {
  return (AGENT_TEMPLATES as readonly string[]).includes(template);
}

export interface LegacyAgentSource {
  template: AgentTemplate;
  config: AssistantConfig;
  /** Только у `customer_bot`. */
  bot: BotSettings | null;
}

export class LegacyMappingError extends Error {
  constructor(
    readonly code:
      'bot_settings_missing' | 'bot_settings_unexpected' | 'not_an_agent' | 'channel_mismatch',
    message: string,
  ) {
    super(message);
    this.name = 'LegacyMappingError';
  }
}

/** Поведение, которое у существующих агентов задано кодом, а не настройками. */
function templateDefaults(template: AgentTemplate) {
  if (template === 'customer_bot') {
    return {
      allowedActions: ['knowledge.search', 'reply.send_in_session', 'lead.create', 'owner.notify'],
      escalation: [
        { when: 'unknown_answer', action: 'offer_contact_form' },
        { when: 'customer_asks_human', action: 'offer_contact_form' },
        { when: 'credits_exhausted', action: 'offer_contact_form' },
      ],
      maxCreditsPerReply: BOT_REPLY_CAP_CREDITS,
      memory: { scope: 'conversation', maxMessages: BOT_HISTORY },
      testing: { minCases: 1, requiredKinds: ['typical', 'unknown'] },
    } as const;
  }
  return {
    allowedActions: ['reply.draft'],
    escalation: [],
    maxCreditsPerReply: null,
    memory: { scope: 'conversation', maxMessages: BOT_HISTORY },
    testing: { minCases: 1, requiredKinds: ['typical'] },
  } as const;
}

const DEFAULT_LIMITS = { maxSteps: 6, maxToolCalls: 4, timeoutMs: 60_000 } as const;

/** Существующие настройки → AgentSpec. Результат проходит `agentSpecSchema`. */
export function agentSpecFromLegacy(source: LegacyAgentSource): AgentSpec {
  const { template, config, bot } = source;
  if (template === 'customer_bot' && !bot) {
    throw new LegacyMappingError('bot_settings_missing', 'customer_bot needs bot settings');
  }
  if (template === 'personal_assistant' && bot) {
    throw new LegacyMappingError(
      'bot_settings_unexpected',
      'personal_assistant has no bot settings',
    );
  }
  const defaults = templateDefaults(template);
  const spec: AgentSpec = {
    specVersion: 1,
    name: config.name,
    role: config.purpose,
    objectives: [],
    instructions: config.instructions,
    tone: config.tone,
    language: config.language,
    knowledge: {
      inline: config.knowledge,
      examples: config.examples.map((example) => ({ ...example })),
      corrections: bot ? bot.corrections.map((item) => ({ ...item })) : [],
      documents: [],
    },
    allowedActions: [...defaults.allowedActions],
    restrictions: [...config.restrictions],
    escalation: defaults.escalation.map((rule) => ({ ...rule })),
    input: TEXT_SHAPE,
    output: TEXT_SHAPE,
    modelPolicy: { selection: 'auto', maxCreditsPerReply: defaults.maxCreditsPerReply },
    memoryPolicy: { ...defaults.memory },
    limits: { ...DEFAULT_LIMITS, dailyCapCredits: bot ? bot.dailyCapCredits : null },
    channel: bot
      ? {
          kind: 'public_page',
          slug: bot.slug,
          greeting: bot.greeting,
          quickReplies: [...bot.quickReplies],
        }
      : { kind: 'ketner_chat' },
    testing: {
      minCases: defaults.testing.minCases,
      requiredKinds: [...defaults.testing.requiredKinds],
    },
  };
  return agentSpecSchema.parse(spec);
}

/**
 * AgentSpec → существующие настройки. Поля, которых в старом формате нет (цели, формы данных,
 * лимиты шагов), не переносятся: старый формат их не хранит.
 */
export function agentSpecToLegacy(
  spec: AgentSpec,
  template: AgentTemplate,
): Omit<LegacyAgentSource, 'template'> {
  const config: AssistantConfig = {
    name: spec.name,
    purpose: spec.role,
    instructions: spec.instructions,
    tone: spec.tone,
    knowledge: spec.knowledge.inline,
    examples: spec.knowledge.examples.map((example) => ({ ...example })),
    restrictions: [...spec.restrictions],
    language: spec.language,
  };
  if (template === 'personal_assistant') {
    if (spec.channel.kind !== 'ketner_chat') {
      throw new LegacyMappingError('channel_mismatch', 'personal_assistant works in Ketner chat');
    }
    return { config, bot: null };
  }
  if (spec.channel.kind !== 'public_page' || spec.limits.dailyCapCredits === null) {
    throw new LegacyMappingError(
      'channel_mismatch',
      'customer_bot needs a public page and a daily cap',
    );
  }
  const bot: BotSettings = {
    slug: spec.channel.slug,
    greeting: spec.channel.greeting,
    quickReplies: [...spec.channel.quickReplies],
    dailyCapCredits: spec.limits.dailyCapCredits,
    corrections: spec.knowledge.corrections.map((item) => ({ ...item })),
  };
  return { config, bot };
}

/** Действия агента, которым нужно одобрение (для экрана одобрений и исполнения). */
export function agentApprovals(spec: AgentSpec, policy: ApprovalPolicy = {}) {
  return spec.allowedActions.filter(isActionId).map((action) => ({
    action,
    risk: actionRisk(action),
    requirement: approvalRequirement(action, policy),
    description: ACTIONS[action].description,
  }));
}

/**
 * Политика одобрения, которая соответствует сегодняшнему поведению шаблона. Владелец, включая бота
 * для клиентов, разрешает ему отвечать посетителям в чате бота — это заранее выданное разрешение
 * на `reply.send_in_session`. Остальные действия существующих агентов риска LOW.
 */
export function legacyApprovalPolicy(template: AgentTemplate): ApprovalPolicy {
  return template === 'customer_bot' ? { standingPermissions: ['reply.send_in_session'] } : {};
}
