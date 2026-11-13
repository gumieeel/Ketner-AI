/**
 * Бот для клиентов на пути платформы (этап D; T4.2–T4.5): AgentSpec → прогон ядра цикла
 * (agent-core/loop.ts) с шагом модели через AIGateway и журналом исполнений Slice A.
 *
 * Включается флагом `BOT_PLATFORM_RUNTIME` (config.ts → botPlatformRuntime); по умолчанию выключен,
 * и бот работает прежним путём (builder/service.ts → answer). Ответ возвращается в том же виде,
 * что у прежнего пути: окружение в bot-service.ts (суточный потолок, баланс, сохранение сообщений,
 * метка контакта) не меняется.
 *
 * Деньги владельца: каждый шаг модели списывается шлюзом, как ответ бота сейчас; ядро передаёт в шаг
 * остаток потолка ответа, поэтому все шаги одного ответа вместе не дороже `BOT_REPLY_CAP_USD`.
 */

import { randomUUID } from 'node:crypto';
import { createGatewayStep } from '../agent-core/gateway-step.js';
import { runAgentLoop } from '../agent-core/loop.js';
import type { LoopEvent, LoopLimits, LoopTool, ModelStep } from '../agent-core/types.js';
import type { AIGateway } from '../ai/gateway.js';
import {
  agentSpecFromLegacy,
  legacyApprovalPolicy,
  type AgentSpec,
} from '../platform/agent-spec.js';
import type { ExecutionJournal, TriggerKind } from '../platform/journal.js';
import { approvalRequirement, isActionId } from '../platform/risk.js';
import type { Language } from '../types.js';
import { PlatformUnavailableError } from './bot-platform-error.js';
import { buildBotInstructions } from './bot-prompt.js';
import type { BuilderCaller } from './service.js';
import type { AssistantConfig, BotSettings } from './types.js';

/** Ответ в том же виде, что у BuilderService.answer, плюс признак эскалации. */
export interface BotAgentAnswer {
  text: string;
  model: { id: string; name: string } | null;
  error: { code: string; message: string } | null;
  costUsd: number;
  creditsUsd: number;
  /** Агент передал разговор человеку (инструмент offer_contact): показать форму заявки. */
  offerContact: boolean;
}

export interface BotAgentInput {
  caller: BuilderCaller;
  solutionId: string;
  version: number;
  config: AssistantConfig;
  bot: BotSettings;
  /** Диалог в учёте шлюза — тот же, что у прежнего пути (`bot:<id>` или `bot:preview:<id>`). */
  gatewayConversationId: string;
  triggerKind: TriggerKind;
  triggerRef: string;
  /** Ключ идемпотентности исполнения (например, id сообщения посетителя). */
  idempotencyKey?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxOutputTokens: number;
  replyCapUsd: number;
}

export interface BotAgentDeps {
  gateway: Pick<AIGateway, 'stream'>;
  journal: ExecutionJournal;
  /** Шаг модели для тестов; по умолчанию — AIGateway с agentStep. */
  stepFactory?: (base: Parameters<typeof createGatewayStep>[1]) => ModelStep;
  limits?: Partial<LoopLimits>;
  log?: (message: string, details: Record<string, unknown>) => void;
}

export { PlatformUnavailableError };

/** Меньше этого остатка новый шаг не начинается (0,5 кредита). */
const MIN_STEP_BUDGET_USD = 0.0005;

const text = (language: Language, ru: string, en: string) => (language === 'en' ? en : ru);

/** Дописка к промпту бота: только на пути платформы, где у модели есть инструменты. */
function toolInstructions(language: Language): string {
  return language === 'en'
    ? `\nTools:\n- knowledge_search: search the owner's knowledge and corrected answers when the answer is not obvious from the data above.\n- offer_contact: when the answer is not in the data, or the customer wants to order, book, talk to a person or complains — call it instead of the ${'[[CONTACT]]'} line, with a short reply to the customer.`
    : `\nИнструменты:\n- knowledge_search — поиск в знаниях владельца и исправленных ответах, если ответ не очевиден из данных выше.\n- offer_contact — если ответа в данных нет или клиент хочет заказать, записаться, поговорить с человеком или жалуется: вызови его вместо строки ${'[[CONTACT]]'}, с коротким ответом клиенту.`;
}

/** Фрагменты знаний и исправленных ответов, где встречаются слова запроса. */
export function searchKnowledge(
  config: AssistantConfig,
  bot: BotSettings,
  query: string,
): string[] {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2)
    .map((word) => word.slice(0, Math.max(3, word.length - 2)));
  if (words.length === 0) return [];
  const pieces = [
    ...config.knowledge
      .split(/(?<=[.!?])\s+|\n+/)
      .map((piece) => piece.trim())
      .filter(Boolean),
    ...bot.corrections.map((item) => `${item.question} — ${item.answer}`),
  ];
  return pieces
    .filter((piece) => words.some((word) => piece.toLowerCase().includes(word)))
    .slice(0, 8);
}

export function botTools(config: AssistantConfig, bot: BotSettings): LoopTool[] {
  return [
    {
      name: 'knowledge_search',
      action: 'knowledge.search',
      description:
        'Search the business owner knowledge and corrected answers (prices, delivery, hours, terms).',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'What to look for' } },
        required: ['query'],
        additionalProperties: false,
      },
      parse(input) {
        const query = (input as { query?: unknown } | null)?.query;
        return typeof query === 'string' && query.trim().length > 0 && query.length <= 300
          ? { ok: true, value: query.trim() }
          : { ok: false, error: 'query must be a non-empty string up to 300 characters' };
      },
      async execute(query) {
        const found = searchKnowledge(config, bot, query as string);
        return {
          content: found.length > 0 ? found.join('\n') : 'Nothing found in the owner knowledge.',
          meta: { matches: found.length },
        };
      },
    },
    {
      name: 'offer_contact',
      // Форма заявки: посетитель оставляет контакт, заявка уходит владельцу (действие lead.create).
      action: 'lead.create',
      description:
        'Hand the conversation to a staff member: the customer gets a form to leave their contact. Use when the answer is unknown or a person is needed.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', enum: ['unknown_answer', 'customer_asks_human'] },
        },
        required: ['reason'],
        additionalProperties: false,
      },
      parse(input) {
        const reason = (input as { reason?: unknown } | null)?.reason;
        return reason === 'unknown_answer' || reason === 'customer_asks_human'
          ? { ok: true, value: reason }
          : { ok: false, error: 'reason must be unknown_answer or customer_asks_human' };
      },
      async execute(reason) {
        return {
          content: 'The contact form is shown to the customer.',
          escalate: { reason: reason as string },
          meta: { reason },
        };
      },
    },
  ];
}

/** Право на действие: в списке AgentSpec и без одобрения (бот: заранее выданное разрешение включения). */
export function authorizeFor(spec: AgentSpec, solutionId: string) {
  const policy = legacyApprovalPolicy('customer_bot');
  return (action: string) => {
    if (!isActionId(action) || !spec.allowedActions.includes(action)) {
      return { allowed: false as const, reason: 'not_in_agent_spec' };
    }
    const requirement = approvalRequirement(action, policy);
    if (requirement !== 'none')
      return { allowed: false as const, reason: `approval_${requirement}` };
    return {
      allowed: true as const,
      authorizedBy: policy.standingPermissions?.includes(action)
        ? `legacy_bot_enablement:${solutionId}`
        : 'risk_low',
    };
  };
}

const STATUS_BY_STOP: Record<string, 'succeeded' | 'failed' | 'cancelled' | 'timed_out'> = {
  answer: 'succeeded',
  escalated: 'succeeded',
  timeout: 'timed_out',
  cancelled: 'cancelled',
};

export class BotAgentRuntime {
  constructor(private readonly deps: BotAgentDeps) {}

  async answer(input: BotAgentInput): Promise<BotAgentAnswer> {
    const { caller, config, bot } = input;
    const language = config.language;
    const spec = agentSpecFromLegacy({ template: 'customer_bot', config, bot });
    const log =
      this.deps.log ?? ((message, details) => console.error(`[bot-agent] ${message}`, details));

    const executionId = `exec_${randomUUID()}`;
    let started: { duplicate: boolean; executionId: string };
    try {
      const { deploymentId } = await this.deps.journal.ensureAgent({
        userId: caller.userId,
        solutionId: input.solutionId,
        version: input.version,
        spec,
        activatedBy: caller.userId,
      });
      started = await this.deps.journal.start({
        id: executionId,
        userId: caller.userId,
        solutionId: input.solutionId,
        solutionVersion: input.version,
        deploymentId,
        triggerKind: input.triggerKind,
        triggerRef: input.triggerRef,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        inputMeta: {
          messages: input.messages.length,
          lastUserChars: input.messages.at(-1)?.content.length ?? 0,
        },
        traceId: executionId,
      });
    } catch (error) {
      throw new PlatformUnavailableError(error);
    }
    if (started.duplicate) {
      return {
        text: '',
        model: null,
        error: {
          code: 'duplicate_execution',
          message: text(
            language,
            'Этот ответ уже готовится.',
            'This reply is already in progress.',
          ),
        },
        costUsd: 0,
        creditsUsd: 0,
        offerContact: false,
      };
    }

    const base = {
      userId: caller.userId,
      userPlan: caller.plan,
      ...(caller.email ? { userEmail: caller.email } : {}),
      isVip: caller.isVip,
      isAnonymous: false,
      conversationId: input.gatewayConversationId,
      modelId: 'auto',
      language,
      stream: true,
      assistant: {
        id: input.solutionId,
        instructions: buildBotInstructions(config, bot) + toolInstructions(language),
        maxOutputTokens: input.maxOutputTokens,
        maxChargeUsd: input.replyCapUsd,
        replaceSystemPrompt: true,
      },
    };
    const step = this.deps.stepFactory?.(base) ?? createGatewayStep(this.deps.gateway, base);
    const authorize = authorizeFor(spec, input.solutionId);
    const tools = botTools(config, bot).filter((tool) => authorize(tool.action).allowed);
    const limits: LoopLimits = {
      maxSteps: spec.limits.maxSteps,
      maxToolCalls: spec.limits.maxToolCalls,
      maxToolCallsPerStep: 4,
      maxConsecutiveFailures: 2,
      timeoutMs: spec.limits.timeoutMs,
      budgetUsd: input.replyCapUsd,
      minStepBudgetUsd: MIN_STEP_BUDGET_USD,
      ...this.deps.limits,
    };

    const journal = this.deps.journal;
    const userId = caller.userId;
    const onEvent = async (event: LoopEvent): Promise<void> => {
      switch (event.type) {
        case 'step_started':
          await journal.reserveEffect(
            executionId,
            userId,
            `model-${event.step}`,
            'reply.draft',
            'risk_low',
            input.solutionId,
          );
          return;
        case 'step_finished':
          await journal.finishEffect(executionId, userId, `model-${event.step}`, 'committed', {
            toolCalls: event.toolCalls,
            model: event.model,
          });
          await journal.event(executionId, userId, 'cost', null, {
            step: event.step,
            costUsd: event.costUsd,
            creditsUsd: event.creditsUsd,
          });
          return;
        case 'step_failed':
          await journal.finishEffect(executionId, userId, `model-${event.step}`, 'failed', {
            code: event.code,
          });
          await journal.event(executionId, userId, 'error', null, {
            step: event.step,
            code: event.code,
          });
          return;
        case 'tool_denied':
          await journal.event(executionId, userId, 'authorization', event.action, {
            tool: event.tool,
            result: 'denied',
            reason: event.reason,
          });
          return;
        case 'tool_started':
          await journal.event(executionId, userId, 'authorization', event.action, {
            tool: event.tool,
            result: 'allowed',
            source: event.authorizedBy,
          });
          await journal.reserveEffect(
            executionId,
            userId,
            `tool-${event.step}-${slug(event.callId)}`,
            event.action,
            event.authorizedBy,
          );
          return;
        case 'tool_finished':
          await journal.finishEffect(
            executionId,
            userId,
            `tool-${event.step}-${slug(event.callId)}`,
            event.ok ? 'committed' : 'failed',
            {
              tool: event.tool,
              ok: event.ok,
              escalate: event.escalate,
              ...(event.meta ?? {}),
            },
          );
          return;
        case 'stopped':
          await journal.event(executionId, userId, 'status', null, { stopReason: event.reason });
      }
    };

    const result = await runAgentLoop({
      messages: input.messages.map((message) => ({ role: message.role, content: message.content })),
      tools,
      step,
      authorize,
      limits,
      onEvent,
      onHookError: (error, event) =>
        log('journal write failed', { executionId, event: event.type, error: String(error) }),
    });

    const escalated = result.stopReason === 'escalated';
    let answer: BotAgentAnswer;
    if (result.stopReason === 'answer' || escalated) {
      const reply =
        result.text.trim() ||
        (escalated
          ? text(
              language,
              'Этот вопрос уточнит сотрудник. Оставьте, пожалуйста, контакт — вам ответят.',
              'A staff member will clarify this. Please leave your contact and you will get a reply.',
            )
          : '');
      answer = {
        text: reply,
        model: result.model,
        error: null,
        costUsd: result.costUsd,
        creditsUsd: result.creditsUsd,
        offerContact: escalated,
      };
    } else {
      // Лимит шагов, потолок кредитов, сбои инструментов, таймаут, ошибка шлюза: бот предлагает контакт
      // (эскалация AgentSpec: credits_exhausted → offer_contact_form), как при ошибке прежнего пути.
      answer = {
        text: '',
        model: result.model,
        error: result.error ?? {
          code: result.stopReason,
          message: `agent stopped: ${result.stopReason}`,
        },
        costUsd: result.costUsd,
        creditsUsd: result.creditsUsd,
        offerContact: true,
      };
    }

    // Ответ клиенту в сессии — эффект с источником «включение бота владельцем».
    if (!answer.error && answer.text) {
      const authorized = authorize('reply.send_in_session');
      if (authorized.allowed) {
        await journal
          .reserveEffect(
            executionId,
            userId,
            'reply',
            'reply.send_in_session',
            authorized.authorizedBy,
          )
          .then(() =>
            journal.finishEffect(executionId, userId, 'reply', 'committed', {
              chars: answer.text.length,
              offerContact: answer.offerContact,
            }),
          )
          .catch((error: unknown) =>
            log('journal write failed', { executionId, event: 'reply', error: String(error) }),
          );
      }
    }
    await journal
      .finish(executionId, userId, {
        status: STATUS_BY_STOP[result.stopReason] ?? 'failed',
        stopReason: result.stopReason,
        costUsd: result.costUsd,
        creditsUsd: result.creditsUsd,
        outputMeta: {
          steps: result.steps,
          toolCalls: result.toolCalls,
          chars: answer.text.length,
          offerContact: answer.offerContact,
        },
        error: answer.error ? { code: answer.error.code } : null,
      })
      .catch((error: unknown) =>
        log('journal write failed', { executionId, event: 'finish', error: String(error) }),
      );
    return answer;
  }
}

/** id вызова инструмента → безопасная часть step_key (`^[a-z][a-z0-9_-]{0,63}$`). */
function slug(callId: string): string {
  return (
    callId
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 40) || 'call'
  );
}
