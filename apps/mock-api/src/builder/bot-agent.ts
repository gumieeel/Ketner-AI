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
 * Если прогон упирается в лимит (шаги, вызовы, кредиты, сбои инструментов), ядро делает последний шаг
 * без инструментов с зарезервированным бюджетом — посетитель получает ответ, а не ошибку (`finalAnswer`).
 *
 * Журнал: до ответа — только то, что обязано быть до него: включение агента (кэш в памяти процесса) и
 * начало исполнения (ключ идемпотентности), а также резерв внешнего действия перед его выполнением.
 * Всё остальное собирается в памяти и пишется одним пакетом после ответа (`drain()` ждёт записи).
 * Исполнение, чей пакет не записался, закрывает reaper (platform/execution-reaper.ts).
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
import type { ExecutionJournal, JournalBatch, TriggerKind } from '../platform/journal.js';
import { ACTIONS, approvalRequirement, isActionId } from '../platform/risk.js';
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
/** Срок одного вызова инструмента бота. */
const BOT_TOOL_TIMEOUT_MS = 5_000;
/** Сколько процесс помнит открытое включение агента, не спрашивая базу. */
const DEPLOYMENT_CACHE_MS = 5 * 60_000;

/** Внешнее действие (уходит из Ketner): резерв эффекта пишется до выполнения, не откладывается. */
function isExternalAction(action: string): boolean {
  return isActionId(action) && ACTIONS[action].consequences.reach === 'external';
}

const text = (language: Language, ru: string, en: string) => (language === 'en' ? en : ru);

/** Дописка к промпту бота: только на пути платформы, где у модели есть инструменты. */
function toolInstructions(language: Language): string {
  return language === 'en'
    ? `\nTools:\n- knowledge_search: search the owner's knowledge and corrected answers when the answer is not obvious from the data above.\n- offer_contact: when the answer is not in the data, or the customer wants to order, book, talk to a person or complains — call it instead of the ${'[[CONTACT]]'} line. Always pass reply: ONE sentence to the customer that names their topic in their words and says a staff member will help, e.g. "Delivery to Astana will be confirmed by a manager — leave your contact and you will get a reply." Never reuse the same sentence for different questions.`
    : `\nИнструменты:\n- knowledge_search — поиск в знаниях владельца и исправленных ответах, если ответ не очевиден из данных выше.\n- offer_contact — если ответа в данных нет или клиент хочет заказать, записаться, поговорить с человеком или жалуется: вызови его вместо строки ${'[[CONTACT]]'}. Всегда передавай reply — ОДНО предложение клиенту, в котором его тема названа его словами и сказано, что поможет сотрудник, например: «Доставку в Астану уточнит менеджер — оставьте контакт, и вам ответят.» Не повторяй одну и ту же фразу для разных вопросов.`;
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
          reply: {
            type: 'string',
            maxLength: 300,
            description:
              'One sentence to the customer in the conversation language that names their topic and says a staff member will help.',
          },
        },
        required: ['reason', 'reply'],
        additionalProperties: false,
      },
      parse(input) {
        const args = (input ?? {}) as { reason?: unknown; reply?: unknown };
        if (args.reason !== 'unknown_answer' && args.reason !== 'customer_asks_human') {
          return { ok: false, error: 'reason must be unknown_answer or customer_asks_human' };
        }
        // Без reply вызов не отклоняется (это стоило бы ещё одного шага модели): тогда — запасная фраза.
        const reply = typeof args.reply === 'string' ? args.reply.trim().slice(0, 300) : '';
        return { ok: true, value: { reason: args.reason, reply } };
      },
      async execute(value) {
        const { reason, reply } = value as { reason: string; reply: string };
        return {
          content: 'The contact form is shown to the customer.',
          escalate: { reason, ...(reply ? { message: reply } : {}) },
          // Текст ответа в журнал не пишется — только его длина.
          meta: { reason, replyChars: reply.length },
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
  private readonly deployments = new Map<string, { id: string; until: number }>();
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly deps: BotAgentDeps) {}

  /** Ждёт отложенные записи журнала (тесты, замеры, остановка сервера). */
  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  /** Включение агента: из памяти процесса, иначе — из журнала (снимок спецификации, открытие). */
  private async deploymentFor(input: BotAgentInput, spec: AgentSpec): Promise<string> {
    const key = `${input.caller.userId}:${input.solutionId}:${input.version}`;
    const cached = this.deployments.get(key);
    if (cached && cached.until > Date.now()) return cached.id;
    const { deploymentId } = await this.deps.journal.ensureAgent({
      userId: input.caller.userId,
      solutionId: input.solutionId,
      version: input.version,
      spec,
      activatedBy: input.caller.userId,
    });
    for (const other of this.deployments.keys()) {
      if (other.startsWith(`${input.caller.userId}:${input.solutionId}:`))
        this.deployments.delete(other);
    }
    this.deployments.set(key, { id: deploymentId, until: Date.now() + DEPLOYMENT_CACHE_MS });
    return deploymentId;
  }

  async answer(input: BotAgentInput): Promise<BotAgentAnswer> {
    const { caller, config, bot } = input;
    const language = config.language;
    const spec = agentSpecFromLegacy({ template: 'customer_bot', config, bot });
    const log =
      this.deps.log ?? ((message, details) => console.error(`[bot-agent] ${message}`, details));

    const executionId = `exec_${randomUUID()}`;
    let started: { duplicate: boolean; executionId: string };
    try {
      const deploymentId = await this.deploymentFor(input, spec);
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
      toolTimeoutMs: BOT_TOOL_TIMEOUT_MS,
      budgetUsd: input.replyCapUsd,
      minStepBudgetUsd: MIN_STEP_BUDGET_USD,
      ...this.deps.limits,
    };

    const journal = this.deps.journal;
    const userId = caller.userId;
    // Пакет журнала: собирается во время прогона, пишется после ответа.
    const batchEffects = new Map<string, JournalBatch['effects'][number] & { open: boolean }>();
    const batchEvents: JournalBatch['events'] = [];
    const openEffect = (stepKey: string, action: string, authorizedBy: string, reserved: boolean) =>
      batchEffects.set(stepKey, {
        stepKey,
        action,
        authorizedBy,
        ...(action === 'reply.draft' ? { usageRunId: input.solutionId } : {}),
        reserved,
        outcome: 'failed',
        resultMeta: {},
        open: true,
      });
    const closeEffect = (
      stepKey: string,
      outcome: 'committed' | 'failed',
      resultMeta: Record<string, unknown>,
    ) => {
      const effect = batchEffects.get(stepKey);
      if (effect?.open) Object.assign(effect, { outcome, resultMeta, open: false });
    };
    const addEvent = (
      type: JournalBatch['events'][number]['type'],
      action: string | null,
      data: Record<string, unknown>,
    ) => batchEvents.push({ type, action, data });

    const onEvent = async (event: LoopEvent): Promise<void> => {
      switch (event.type) {
        case 'step_started':
          openEffect(`model-${event.step}`, 'reply.draft', 'risk_low', false);
          return;
        case 'step_finished':
          closeEffect(`model-${event.step}`, 'committed', {
            toolCalls: event.toolCalls,
            model: event.model,
          });
          addEvent('cost', null, {
            step: event.step,
            costUsd: event.costUsd,
            creditsUsd: event.creditsUsd,
          });
          return;
        case 'step_failed':
          closeEffect(`model-${event.step}`, 'failed', { code: event.code });
          addEvent('error', null, { step: event.step, code: event.code });
          return;
        case 'tool_denied':
          addEvent('authorization', event.action, {
            tool: event.tool,
            result: 'denied',
            reason: event.reason,
          });
          return;
        case 'tool_rejected':
          // Подробность (текст ошибки разбора) — только в журнал; модель получила безопасное сообщение.
          addEvent('error', null, {
            step: event.step,
            tool: event.tool,
            code: event.code,
            detail: event.detail,
          });
          return;
        case 'tool_started': {
          addEvent('authorization', event.action, {
            tool: event.tool,
            result: 'allowed',
            source: event.authorizedBy,
          });
          const stepKey = `tool-${event.step}-${slug(event.callId)}`;
          if (isExternalAction(event.action)) {
            // Внешнее действие: резерв в базе до выполнения (повтор не выполнит его второй раз).
            await journal.reserveEffect(
              executionId,
              userId,
              stepKey,
              event.action,
              event.authorizedBy,
            );
            openEffect(stepKey, event.action, event.authorizedBy, true);
          } else {
            openEffect(stepKey, event.action, event.authorizedBy, false);
          }
          return;
        }
        case 'tool_finished':
          closeEffect(
            `tool-${event.step}-${slug(event.callId)}`,
            event.ok ? 'committed' : 'failed',
            {
              tool: event.tool,
              ok: event.ok,
              escalate: event.escalate,
              ...(event.meta ?? {}),
              ...(event.error ? { error: event.error } : {}),
            },
          );
          if (event.error) {
            addEvent('error', event.action, {
              step: event.step,
              tool: event.tool,
              code: event.error.code,
              message: event.error.message,
            });
          }
          return;
        case 'stopped':
          addEvent('status', null, { stopReason: event.reason });
      }
    };

    const result = await runAgentLoop({
      messages: input.messages.map((message) => ({ role: message.role, content: message.content })),
      tools,
      step,
      authorize,
      limits,
      finalAnswer: true,
      onEvent,
      onHookError: (error, event) =>
        log('journal write failed', { executionId, event: event.type, error: String(error) }),
    });

    const escalated = result.stopReason === 'escalated';
    const answered = result.stopReason === 'answer' || escalated || result.finalStep;
    let answer: BotAgentAnswer;
    if (answered && (result.text.trim() || escalated)) {
      // Текст шага, иначе ответ из аргументов offer_contact; запасная фраза — только если пусто и там.
      const reply =
        result.text.trim() ||
        result.escalation?.message?.trim() ||
        text(
          language,
          'Этот вопрос уточнит сотрудник. Оставьте, пожалуйста, контакт — вам ответят.',
          'A staff member will clarify this. Please leave your contact and you will get a reply.',
        );
      answer = {
        text: reply,
        model: result.model,
        error: null,
        costUsd: result.costUsd,
        creditsUsd: result.creditsUsd,
        // После лимита ответ собран из того, что успели найти: форма контакта — на случай, если его мало.
        offerContact: escalated || result.finalStep,
      };
    } else {
      // Ошибка шлюза, таймаут, отмена или лимит без бюджета на последний шаг: бот предлагает контакт
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
        openEffect('reply', 'reply.send_in_session', authorized.authorizedBy, false);
        closeEffect('reply', 'committed', {
          chars: answer.text.length,
          offerContact: answer.offerContact,
        });
      }
    }
    const batch: JournalBatch = {
      // Эффект, не закрытый прогоном (прерванный шаг или вызов), закрывается как `failed`.
      effects: [...batchEffects.values()].map(({ open, ...effect }) =>
        open ? { ...effect, outcome: 'failed' as const, resultMeta: { unfinished: true } } : effect,
      ),
      events: batchEvents,
      finish: {
        status:
          answered && !answer.error ? 'succeeded' : (STATUS_BY_STOP[result.stopReason] ?? 'failed'),
        stopReason: result.stopReason,
        costUsd: result.costUsd,
        creditsUsd: result.creditsUsd,
        outputMeta: {
          steps: result.steps,
          toolCalls: result.toolCalls,
          chars: answer.text.length,
          offerContact: answer.offerContact,
          finalStep: result.finalStep,
        },
        error: answer.error ? { code: answer.error.code } : null,
      },
    };
    const write = journal
      .record(executionId, userId, batch)
      .catch((error: unknown) =>
        log('journal write failed', { executionId, event: 'record', error: String(error) }),
      );
    this.pending.add(write);
    void write.finally(() => this.pending.delete(write));
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
