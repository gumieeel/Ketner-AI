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
  /** Письмо владельцу о новой заявке (ошибка письма заявку не теряет). */
  notifyLead?: (owner: BotOwner, solution: Solution, lead: BotLead) => Promise<void>;
  now?: () => Date;
}

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
    return version?.config ?? null;
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
    await this.save(solution, conversation, {
      role: 'user',
      content: input.content,
      model: null,
      offerContact: false,
      creditsUsd: 0,
      status: 'complete',
    });

    // Деньги владельца: суточный потолок и баланс проверяются до вызова модели.
    const usage = await this.deps.store.botUsageSince(solution.id, dayStart(this.now()));
    const overCap = toCredits(usage.creditsUsd) >= solution.bot.dailyCapCredits;
    const lowBalance = this.deps.balanceUsd(owner.userId, owner.plan) < BOT_REPLY_CAP_USD;
    if (overCap || lowBalance) {
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
    const answer = await this.deps.builder.answer(
      caller,
      null,
      `bot:${conversation.id}`,
      buildBotInstructions(config, solution.bot),
      [
        ...history
          .filter((item) => item.status === 'complete')
          .map((item) => ({ role: item.role, content: item.content })),
        { role: 'user' as const, content: input.content },
      ],
      {
        solutionId: solution.id,
        maxOutputTokens: BOT_REPLY_TOKENS,
        maxChargeUsd: BOT_REPLY_CAP_USD,
        replaceSystemPrompt: true,
      },
    );
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
        creditsUsd: answer.creditsUsd,
        status: 'error',
      });
      return { ok: true, conversationId: conversation.id, message: publicBotMessage(saved) };
    }
    const parsed = parseBotReply(answer.text);
    const saved = await this.save(solution, conversation, {
      role: 'assistant',
      content: parsed.text,
      model: answer.model,
      offerContact: parsed.offerContact,
      creditsUsd: answer.creditsUsd,
      status: 'complete',
    });
    return { ok: true, conversationId: conversation.id, message: publicBotMessage(saved) };
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
    if (!version) return notFound();
    if (this.deps.balanceUsd(caller.userId, caller.plan) < BOT_REPLY_CAP_USD) {
      return {
        ok: false,
        status: 402,
        code: 'insufficient_credits',
        message: text(
          caller.language,
          'Не хватает кредитов на ответ бота (до 30 кредитов за ответ).',
          'Not enough credits for a bot reply (up to 30 credits per reply).',
        ),
      };
    }
    const answer = await this.deps.builder.answer(
      { ...caller, language: version.config.language },
      null,
      `bot:preview:${solution.id}`,
      buildBotInstructions(version.config, solution.bot),
      messages.slice(-BOT_HISTORY),
      {
        solutionId: solution.id,
        maxOutputTokens: BOT_REPLY_TOKENS,
        maxChargeUsd: BOT_REPLY_CAP_USD,
        replaceSystemPrompt: true,
      },
    );
    if (answer.error) {
      return { ok: false, status: 502, code: answer.error.code, message: answer.error.message };
    }
    const parsed = parseBotReply(answer.text);
    return {
      ok: true,
      content: parsed.text,
      offerContact: parsed.offerContact,
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
