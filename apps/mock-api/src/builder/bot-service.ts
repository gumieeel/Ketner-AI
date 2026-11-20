/**
 * Бот для клиентов (docs/AUTOMATION_PLAN.md, этап B).
 *
 * Публичная сторона: страница ketner.org/b/<адрес> без входа — посетитель пишет, бот отвечает
 * через общий AI Gateway за кредиты владельца (Auto, своя версия промпта, потолок цены ответа).
 * Не знает ответа, клиенту нужен человек, кончились кредиты или суточный потолок — бот
 * предлагает оставить контакт; заявка бесплатна и приходит владельцу на почту.
 *
 * Сторона владельца: настройки страницы (адрес, приветствие, кнопки, потолок, исправленные
 * ответы), расход за сегодня, диалоги, заявки и проба бота «как клиент» до включения.
 * Поведение бота — в версиях настроек и проверяется тест-кейсами, как у помощника.
 */

import { randomUUID } from 'node:crypto';
import { toCredits } from '../services/entitlement.js';
import type { Language, PlanId } from '../types.js';
import { buildBotInstructions, parseBotReply, SLUG_PATTERN } from './bot-prompt.js';
import type { BuilderCaller, BuilderService } from './service.js';
import type { BuilderStore } from './store.js';
import type {
  AssistantConfig,
  BotConversation,
  BotLead,
  BotMessage,
  BotSettings,
  Solution,
} from './types.js';
import { isToolConfig } from './types.js';
import type { BotAgentAnswer, BotAgentInput } from './bot-agent.js';
import { PlatformUnavailableError } from './bot-platform-error.js';
import { allowanceRefusal } from '../billing/build-allowance.js';
import type { TierAlerts } from '../billing/tier-alerts.js';
import { decide, tierEnforced, type TierDecision, type TierUsage } from '../billing/tier-usage.js';

/** Строка «Обращений в этом месяце: N из M» для панели бота. */
function requestsView(decision: TierDecision) {
  return {
    tier: decision.tier,
    used: decision.used,
    included: decision.included,
    limit: decision.limit,
    state: decision.state,
    periodEnd: decision.periodEnd,
    // Включены ли тарифы: без них предупреждения в панели не нужны — ограничений ещё нет.
    enforced: tierEnforced(),
  };
}

/** С владельца за один ответ бота не списывается больше, $ (≈ 30 кредитов). */
export const BOT_REPLY_CAP_USD = 0.03;
export const BOT_REPLY_TOKENS = 600;
/** Сколько последних сообщений диалога видит бот. */
export const BOT_HISTORY = 12;
export const BOT_LIMITS = {
  message: 1000,
  greeting: 300,
  quickReplies: 4,
  quickReply: 60,
  corrections: 30,
  correctionChars: 600,
  dailyCapMin: 50,
  dailyCapMax: 50_000,
  leadName: 80,
  leadContact: 120,
  leadQuestion: 1000,
} as const;

export interface BotOwner {
  userId: string;
  plan: PlanId;
  email?: string;
  isVip: boolean;
}

export interface BotServiceDeps {
  store: BuilderStore;
  builder: BuilderService;
  balanceUsd: (userId: string, plan: PlanId) => number;
  /** Владелец бота с действующим тарифом (null — аккаунта больше нет). */
  owner: (ownerId: string) => BotOwner | null;
  /**
   * Тариф и счётчик обращений (P3). Пока `TIER_ENFORCED = false`, решение только считается и
   * пишется в лог «как было бы»; ответы оплачивает баланс, как раньше.
   */
  tierUsage?: TierUsage;
  /**
   * Письма владельцу об объёме тарифа (80% и режим заявок, раз за период). Только при включённых
   * тарифах; ошибка письма ответ посетителю не задерживает.
   */
  tierAlerts?: TierAlerts;
  /** Письмо владельцу о новой заявке (ошибка письма заявку не теряет). */
  notifyLead?: (owner: BotOwner, solution: Solution, lead: BotLead) => Promise<void>;
  /**
   * Путь платформы (этап D, builder/bot-agent.ts) за флагом BOT_PLATFORM_RUNTIME. Нет или флаг
   * выключен для решения — прежний путь (builder.answer), без каких-либо изменений.
   */
  platform?: {
    enabled: (solutionId: string) => boolean;
    answer: (input: BotAgentInput) => Promise<BotAgentAnswer>;
  };
  now?: () => Date;
}

/** Ответ модели в общем виде: у прежнего пути `offerContact` нет, у платформы — признак эскалации. */
type BotAnswer = Awaited<ReturnType<BuilderService['answer']>> & { offerContact?: boolean };

export type BotError = {
  ok: false;
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
};
type Ok<T> = { ok: true } & T;

const text = (language: Language, ru: string, en: string) => (language === 'en' ? en : ru);

/** Публичный вид сообщения: без владельца и расхода. */
export function publicBotMessage(message: BotMessage) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    offerContact: message.offerContact,
    status: message.status,
    createdAt: message.createdAt,
  };
}

/** Начало суток UTC: суточный потолок и «расход за сегодня». */
function dayStart(now: Date): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

export class BotService {
  private readonly now: () => Date;

  constructor(private readonly deps: BotServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  // ─── Публичная страница ────────────────────────────────────────────────────

  /** Бот по адресу: черновик не виден; выключенный — виден как «временно не отвечает». */
  private async publicBot(slug: string): Promise<Solution | null> {
    if (!SLUG_PATTERN.test(slug)) return null;
    const solution = await this.deps.store.getSolutionBySlug(slug);
    if (!solution || solution.type !== 'customer_bot' || !solution.bot) return null;
    if (solution.status === 'draft' || solution.activeVersion === null) return null;
    return solution;
  }

  private async activeConfig(solution: Solution): Promise<AssistantConfig | null> {
    if (solution.activeVersion === null) return null;
    const version = await this.deps.store.getVersion(
      solution.ownerId,
      solution.id,
      solution.activeVersion,
    );
    return version && !isToolConfig(version.config) ? version.config : null;
  }

  async publicInfo(slug: string) {
    const solution = await this.publicBot(slug);
    if (!solution?.bot) return null;
    const config = await this.activeConfig(solution);
    return {
      slug: solution.bot.slug,
      name: config?.name ?? solution.name,
      greeting: solution.bot.greeting,
      quickReplies: solution.bot.quickReplies,
      language: config?.language ?? 'ru',
      status: solution.status === 'active' ? ('active' as const) : ('paused' as const),
    };
  }

  /** История диалога посетителя: страница бота восстанавливает переписку после перезагрузки. */
  async publicHistory(slug: string, visitorId: string, conversationId: string) {
    const solution = await this.publicBot(slug);
    if (!solution) return null;
    const conversation = await this.deps.store.getConversation(solution.id, conversationId);
    if (!conversation || conversation.visitorId !== visitorId) return null;
    const messages = await this.deps.store.botHistory(solution.id, conversation.id, 100);
    return messages.map(publicBotMessage);
  }

  async send(
    slug: string,
    input: { visitorId: string; conversationId?: string | undefined; content: string },
  ): Promise<
    Ok<{ conversationId: string; message: ReturnType<typeof publicBotMessage> }> | BotError
  > {
    const solution = await this.publicBot(slug);
    if (!solution?.bot) return notFound();
    const config = await this.activeConfig(solution);
    const language = config?.language ?? 'ru';
    if (solution.status !== 'active' || !config) {
      return {
        ok: false,
        status: 409,
        code: 'bot_paused',
        message: text(
          language,
          'Бот временно не отвечает. Оставьте контакт — вам ответят.',
          'The bot is not answering right now. Leave your contact and you will get a reply.',
        ),
      };
    }
    const owner = this.deps.owner(solution.ownerId);
    if (!owner) return notFound();

    // Диалог посетителя: чужой или неизвестный id — новый диалог.
    let conversation =
      input.conversationId !== undefined
        ? await this.deps.store.getConversation(solution.id, input.conversationId)
        : null;
    if (!conversation || conversation.visitorId !== input.visitorId) {
      const iso = this.now().toISOString();
      conversation = {
        id: randomUUID(),
        solutionId: solution.id,
        ownerId: solution.ownerId,
        visitorId: input.visitorId,
        messageCount: 0,
        createdAt: iso,
        updatedAt: iso,
      };
      await this.deps.store.createConversation(conversation);
    }
    const history = await this.deps.store.botHistory(solution.id, conversation.id, BOT_HISTORY);
    const userMessage = await this.save(solution, conversation, {
      role: 'user',
      content: input.content,
      model: null,
      offerContact: false,
      creditsUsd: 0,
      status: 'complete',
    });

    // До вызова модели: суточный потолок бота (по стоимости ответов), тариф и счётчик обращений (P3).
    // Тарифы выключены — решение только в лог «как было бы», а ответ оплачивает баланс, как раньше.
    const usage = await this.deps.store.botUsageSince(solution.id, dayStart(this.now()));
    const overCap = toCredits(usage.creditsUsd) >= solution.bot.dailyCapCredits;
    const tierUsage = this.deps.tierUsage;
    // Счётчик не прочитан (журнал недоступен): пока тарифы выключены — ответ как раньше; включены —
    // форма заявки без вызова модели (посетитель не видит ошибку, деньги не тратятся).
    let decision: TierDecision | null = null;
    let tierUnknown = false;
    if (tierUsage) {
      try {
        decision = await tierUsage.decision(owner.userId);
      } catch (error) {
        tierUnknown = tierEnforced();
        console.error('[tiers] решение не посчитано:', error);
      }
    }
    const tierFunded = decision !== null && tierEnforced();
    if (decision && !tierFunded) tierUsage!.shadow(owner.userId, decision);
    const blockedByTier = tierUnknown || (tierFunded && decision?.action !== 'answer');
    // Режим заявок: владелец узнаёт об этом письмом (один раз за период).
    if (tierFunded && decision?.action === 'leads_only') this.alert(owner.userId, decision);
    const lowBalance =
      !tierFunded &&
      !tierUnknown &&
      this.deps.balanceUsd(owner.userId, owner.plan) < BOT_REPLY_CAP_USD;
    if (overCap || lowBalance || blockedByTier) {
      const saved = await this.save(solution, conversation, {
        role: 'assistant',
        content: text(
          language,
          'Сейчас я не могу ответить сам. Оставьте, пожалуйста, имя и телефон или мессенджер — вам ответят.',
          'I cannot answer right now. Please leave your name and phone or messenger, and you will get a reply.',
        ),
        model: null,
        offerContact: true,
        creditsUsd: 0,
        status: 'complete',
      });
      return { ok: true, conversationId: conversation.id, message: publicBotMessage(saved) };
    }

    const caller: BuilderCaller = {
      userId: owner.userId,
      plan: owner.plan,
      ...(owner.email ? { email: owner.email } : {}),
      isVip: owner.isVip,
      anonymous: false,
      language,
    };
    const dialog = [
      ...history
        .filter((item) => item.status === 'complete')
        .map((item) => ({ role: item.role, content: item.content })),
      { role: 'user' as const, content: input.content },
    ];
    const answer = await this.answerBot(
      solution,
      config,
      solution.activeVersion ?? solution.currentVersion,
      caller,
      `bot:${conversation.id}`,
      dialog,
      {
        triggerKind: 'public_page',
        triggerRef: `conversation:${conversation.id}`,
        idempotencyKey: `bot_message:${userMessage.id}`,
      },
      tierFunded ? 'tier' : undefined,
    );
    // На тарифе баланс не списывается; суточный потолок бота считается по стоимости ответа.
    const replyCostUsd = tierFunded ? answer.costUsd : answer.creditsUsd;
    if (answer.error || !answer.text.trim()) {
      const saved = await this.save(solution, conversation, {
        role: 'assistant',
        content: text(
          language,
          'Не получилось ответить. Попробуйте ещё раз или оставьте контакт — вам ответят.',
          'Could not answer. Try again or leave your contact and you will get a reply.',
        ),
        model: answer.model,
        offerContact: true,
        creditsUsd: replyCostUsd,
        status: 'error',
      });
      return { ok: true, conversationId: conversation.id, message: publicBotMessage(saved) };
    }
    const parsed = parseBotReply(answer.text);
    const saved = await this.save(solution, conversation, {
      role: 'assistant',
      content: parsed.text,
      model: answer.model,
      offerContact: parsed.offerContact || answer.offerContact === true,
      creditsUsd: replyCostUsd,
      status: 'complete',
    });
    tierUsage?.noteCounted(owner.userId);
    // Засчитанный ответ на тарифе: перешли 80% (или в льготный объём) — письмо владельцу один раз.
    if (tierFunded && decision?.tier) {
      this.alert(owner.userId, decide(decision.tier, decision.used + 1, decision.periodEnd));
    }
    return { ok: true, conversationId: conversation.id, message: publicBotMessage(saved) };
  }

  /** Письмо об объёме тарифа — без ожидания: ответ посетителю не ждёт почту и хранилище. */
  private alert(userId: string, decision: TierDecision): void {
    void this.deps.tierAlerts?.check(userId, decision).catch((error: unknown) => {
      console.error('[tiers] письмо об объёме не отправлено:', error);
    });
  }

  /**
   * Ответ бота. Флаг пути платформы выключен (по умолчанию) — ровно прежний вызов builder.answer.
   * Включён — ядро цикла агента (builder/bot-agent.ts) с тем же промптом, потолками и учётом; если
   * путь платформы недоступен до первого вызова модели (журнал не записался), ответ идёт прежним путём.
   */
  private async answerBot(
    solution: Solution,
    config: AssistantConfig,
    version: number,
    caller: BuilderCaller,
    gatewayConversationId: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    trigger: Pick<BotAgentInput, 'triggerKind' | 'triggerRef' | 'idempotencyKey'>,
    funding?: BotAgentInput['funding'],
  ): Promise<BotAnswer> {
    const platform = this.deps.platform;
    if (platform && solution.bot && platform.enabled(solution.id)) {
      try {
        return await platform.answer({
          caller,
          solutionId: solution.id,
          version,
          config,
          bot: solution.bot,
          gatewayConversationId,
          ...trigger,
          messages,
          maxOutputTokens: BOT_REPLY_TOKENS,
          replyCapUsd: BOT_REPLY_CAP_USD,
          ...(funding ? { funding } : {}),
        });
      } catch (error) {
        if (!(error instanceof PlatformUnavailableError)) throw error;
        console.error(`[bot] путь платформы недоступен, ответ прежним путём: ${error.message}`);
      }
    }
    return this.deps.builder.answer(
      caller,
      null,
      gatewayConversationId,
      buildBotInstructions(config, solution.bot!),
      messages,
      {
        solutionId: solution.id,
        maxOutputTokens: BOT_REPLY_TOKENS,
        maxChargeUsd: BOT_REPLY_CAP_USD,
        replaceSystemPrompt: true,
        ...(funding ? { funding } : {}),
      },
    );
  }

  private async save(
    solution: Solution,
    conversation: BotConversation,
    message: Omit<BotMessage, 'id' | 'conversationId' | 'solutionId' | 'ownerId' | 'createdAt'>,
  ): Promise<BotMessage> {
    const saved: BotMessage = {
      id: randomUUID(),
      conversationId: conversation.id,
      solutionId: solution.id,
      ownerId: solution.ownerId,
      createdAt: this.now().toISOString(),
      ...message,
    };
    await this.deps.store.addBotMessage(saved);
    return saved;
  }

  async createLead(
    slug: string,
    input: {
      visitorId: string;
      conversationId?: string | undefined;
      name: string;
      contact: string;
      question: string;
    },
  ): Promise<Ok<{ leadId: string }> | BotError> {
    // Заявку можно оставить и у выключенного бота: клиент не должен теряться.
    const solution = await this.publicBot(slug);
    if (!solution) return notFound();
    const conversation = input.conversationId
      ? await this.deps.store.getConversation(solution.id, input.conversationId)
      : null;
    const iso = this.now().toISOString();
    const lead: BotLead = {
      id: randomUUID(),
      solutionId: solution.id,
      ownerId: solution.ownerId,
      conversationId:
        conversation && conversation.visitorId === input.visitorId ? conversation.id : null,
      name: input.name,
      contact: input.contact,
      question: input.question,
      status: 'new',
      createdAt: iso,
      updatedAt: iso,
    };
    await this.deps.store.createLead(lead);
    const owner = this.deps.owner(solution.ownerId);
    if (owner && this.deps.notifyLead) {
      await this.deps.notifyLead(owner, solution, lead).catch((error: unknown) => {
        console.error(`[bot] письмо о заявке ${lead.id} не отправлено`, error);
      });
    }
    return { ok: true, leadId: lead.id };
  }

  // ─── Владелец ──────────────────────────────────────────────────────────────

  private async ownBot(ownerId: string, id: string): Promise<Solution | null> {
    const solution = await this.deps.store.getSolution(ownerId, id);
    return solution && solution.type === 'customer_bot' && solution.bot ? solution : null;
  }

  async overview(ownerId: string, id: string) {
    const solution = await this.ownBot(ownerId, id);
    if (!solution?.bot) return null;
    const usage = await this.deps.store.botUsageSince(solution.id, dayStart(this.now()));
    return {
      settings: solution.bot,
      today: {
        replies: usage.replies,
        credits: toCredits(usage.creditsUsd),
        newLeads: await this.deps.store.countNewLeads(ownerId, id),
      },
      // Обращения в этом месяце по тарифу (P3); нет сервиса тарифов — поля нет.
      ...(this.deps.tierUsage
        ? { requests: requestsView(await this.deps.tierUsage.decision(ownerId)) }
        : {}),
    };
  }

  async updateSettings(
    caller: BuilderCaller,
    id: string,
    patch: Partial<BotSettings>,
  ): Promise<Ok<{ settings: BotSettings }> | BotError> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const solution = await this.ownBot(caller.userId, id);
      if (!solution?.bot) return notFound();
      const next: BotSettings = { ...solution.bot, ...patch };
      if (next.slug !== solution.bot.slug) {
        if (!SLUG_PATTERN.test(next.slug)) {
          return {
            ok: false,
            status: 400,
            code: 'invalid_slug',
            message: text(
              caller.language,
              'Адрес: 3–40 символов, латинские буквы, цифры и дефис.',
              'Address: 3–40 characters, Latin letters, digits and hyphens.',
            ),
          };
        }
        if (await this.deps.store.slugTaken(next.slug)) {
          return {
            ok: false,
            status: 409,
            code: 'slug_taken',
            message: text(caller.language, 'Этот адрес уже занят.', 'This address is taken.'),
          };
        }
      }
      let updated: Solution | null;
      try {
        updated = await this.deps.store.updateSolution(
          { ...solution, bot: next, updatedAt: this.now().toISOString() },
          solution.version,
        );
      } catch {
        // Гонка за адрес: его заняли между проверкой и записью.
        return {
          ok: false,
          status: 409,
          code: 'slug_taken',
          message: text(caller.language, 'Этот адрес уже занят.', 'This address is taken.'),
        };
      }
      if (updated?.bot) return { ok: true, settings: updated.bot };
    }
    return {
      ok: false,
      status: 409,
      code: 'conflict',
      message: text(
        caller.language,
        'Бот только что изменился. Обновите страницу.',
        'The bot has just changed. Reload the page.',
      ),
    };
  }

  /**
   * Проба «как клиент» до включения и после правок: текущая (не включённая) версия настроек,
   * за кредиты владельца, ничего не сохраняется.
   */
  async preview(
    caller: BuilderCaller,
    id: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<
    | Ok<{ content: string; offerContact: boolean; chargedCredits: number; model: string | null }>
    | BotError
  > {
    const solution = await this.ownBot(caller.userId, id);
    if (!solution?.bot) return notFound();
    const version = await this.deps.store.getVersion(
      caller.userId,
      solution.id,
      solution.currentVersion,
    );
    if (!version || isToolConfig(version.config)) return notFound();
    // Проба «как клиент» платит бесплатный лимит создания и проверки, а не баланс (P2).
    const allowance = this.deps.builder.allowance;
    const reservation = await allowance.reserve(caller.userId, BOT_REPLY_CAP_USD);
    if (!reservation.ok) {
      const refusal = allowanceRefusal(caller.language, reservation);
      return {
        ok: false,
        status: refusal.status,
        code: refusal.code,
        message: refusal.message,
      };
    }
    let spentUsd = BOT_REPLY_CAP_USD;
    let answer: BotAnswer;
    try {
      answer = await this.answerBot(
        solution,
        version.config,
        solution.currentVersion,
        { ...caller, language: version.config.language },
        `bot:preview:${solution.id}`,
        messages.slice(-BOT_HISTORY),
        { triggerKind: 'manual', triggerRef: `preview:${solution.id}` },
        'allowance',
      );
      spentUsd = answer.costUsd;
    } finally {
      await allowance.settle(reservation.ticket, spentUsd);
    }
    if (answer.error) {
      return { ok: false, status: 502, code: answer.error.code, message: answer.error.message };
    }
    const parsed = parseBotReply(answer.text);
    return {
      ok: true,
      content: parsed.text,
      offerContact: parsed.offerContact || answer.offerContact === true,
      chargedCredits: toCredits(answer.creditsUsd),
      model: answer.model?.name ?? null,
    };
  }

  async conversations(ownerId: string, id: string) {
    if (!(await this.ownBot(ownerId, id))) return null;
    return this.deps.store.listConversations(ownerId, id, 100);
  }

  async conversationMessages(ownerId: string, id: string, conversationId: string) {
    if (!(await this.ownBot(ownerId, id))) return null;
    const messages = await this.deps.store.listBotMessages(ownerId, id, conversationId);
    return messages.length > 0 ? messages : null;
  }

  async leads(ownerId: string, id: string) {
    if (!(await this.ownBot(ownerId, id))) return null;
    return this.deps.store.listLeads(ownerId, id, 200);
  }

  async setLeadStatus(ownerId: string, id: string, leadId: string, status: BotLead['status']) {
    if (!(await this.ownBot(ownerId, id))) return null;
    return this.deps.store.setLeadStatus(ownerId, id, leadId, status, this.now().toISOString());
  }
}

function notFound(): BotError {
  return { ok: false, status: 404, code: 'bot_not_found', message: 'Бот не найден' };
}
