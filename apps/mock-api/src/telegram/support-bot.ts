import { config } from '../config.js';
import type { SupportStore, SupportTicket } from '../store/support-store.js';
import {
  supportStore as defaultSupportStore,
  userStore as defaultUserStore,
} from '../store/index.js';
import type { UserStore } from '../store/user-store.js';
import type { TelegramUpdate } from './bot.js';

/**
 * Заявки на возврат в чате администратора поддержки. Реализует платёжный бот (у него биллинг):
 * бот поддержки только показывает заявки, принимает решения кнопками и пересылает ответы.
 */
export interface RefundDesk {
  /** Одобрить или отклонить заявку. Возвращает строку итога для сообщения администратора. */
  decide(ref: string, approve: boolean): Promise<string>;
  /** Ответ администратора клиенту по заявке. Возвращает подпись клиента для подтверждения. */
  reply(ref: string, text: string): Promise<string>;
  /** Список открытых заявок для команды /refunds. */
  pendingSummary(): string;
}

/** Номер заявки в тексте сообщения бота: «R-<16 символов>». */
const REFUND_TAG = /R-([A-Za-z0-9_-]{16})/;

export interface TelegramSupportBotDeps {
  supportStore?: SupportStore;
  botToken?: string;
  botUsername?: string;
  adminUsername?: string;
  /** Закреплённый чат администратора (SUPPORT_ADMIN_CHAT_ID): тогда username уже не даёт прав. */
  adminChatId?: number;
  /**
   * Администраторы сайта с привязанным Telegram — им тоже приходят уведомления. Список хранится
   * в базе и переживает деплой (файл поддержки на Render стирается при каждом перезапуске).
   */
  userStore?: Pick<UserStore, 'list'>;
}

export class TelegramSupportBotService {
  private token: string;
  private username: string;
  private adminUsername: string;
  private pinnedAdminChatId: number | undefined;
  private store: SupportStore;
  private isPolling = false;
  private refundDesk: RefundDesk | null = null;
  private users: Pick<UserStore, 'list'> | null;

  constructor(deps: TelegramSupportBotDeps = {}) {
    this.store = deps.supportStore || defaultSupportStore;
    // Без явного хранилища (тесты с собственным store) — только чат из store/env.
    this.users = deps.userStore ?? (deps.supportStore ? null : defaultUserStore);
    this.token = deps.botToken || config.telegramSupportBotToken || '';
    this.username = (
      deps.botUsername ||
      config.telegramSupportBotUsername ||
      'ketner_support_bot'
    ).replace(/^@/, '');
    this.adminUsername = (deps.adminUsername || config.supportAdminUsername || 'gumieeel')
      .replace(/^@/, '')
      .toLowerCase();

    this.pinnedAdminChatId = deps.adminChatId ?? config.supportAdminChatId;
    if (this.pinnedAdminChatId && !this.store.getAdminChatId()) {
      this.store.setAdminChatId(this.pinnedAdminChatId);
    }
  }

  attachRefundDesk(desk: RefundDesk): void {
    this.refundDesk = desk;
  }

  /**
   * Заявка на возврат в чат администратора. С кнопками «Одобрить / Отказать», если решение нужно.
   * Ответ (Reply) на это сообщение уходит клиенту. false — чат администратора недоступен.
   */
  async postRefundNotice(ref: string, text: string, actionable: boolean): Promise<boolean> {
    let delivered = false;
    for (const chatId of this.adminChats()) {
      const sent = await this.sendMessage(chatId, text, {
        link_preview_options: { is_disabled: true },
        ...(actionable
          ? {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '✅ Одобрить возврат', callback_data: `rf:y:${ref}` },
                    { text: '✖️ Отказать', callback_data: `rf:n:${ref}` },
                  ],
                ],
              },
            }
          : {}),
      });
      if (!sent?.message_id) continue;
      this.store.linkAdminRefund(ref, sent.message_id);
      delivered = true;
    }
    return delivered;
  }

  async answerCallbackQuery(id: string, text?: string, showAlert = false): Promise<unknown> {
    return this.callApi('answerCallbackQuery', {
      callback_query_id: id,
      text,
      show_alert: showAlert,
    });
  }

  async editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
  ): Promise<unknown> {
    return this.callApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  }

  /**
   * Куда слать уведомления администратору. Закреплённый чат (SUPPORT_ADMIN_CHAT_ID) — только он.
   * Иначе: чат, сохранённый после /start, и чаты администраторов сайта с привязанным Telegram
   * (личный чат в Telegram = id пользователя, он одинаков для всех ботов).
   */
  adminChats(): Array<number | string> {
    if (this.pinnedAdminChatId) return [this.pinnedAdminChatId];
    const chats = new Map<string, number | string>();
    const saved = this.store.getAdminChatId();
    if (saved) chats.set(String(saved), saved);
    for (const user of this.users?.list() ?? []) {
      if (user.isAdmin && user.telegramChatId)
        chats.set(String(user.telegramChatId), user.telegramChatId);
    }
    return [...chats.values()];
  }

  private isAdminChat(chatId: number | string): boolean {
    return this.adminChats().some((admin) => String(admin) === String(chatId));
  }

  /** Уведомление всем администраторам. true — хотя бы одному доставлено. */
  async notifyAdmins(text: string, extra: Record<string, unknown> = {}): Promise<boolean> {
    let delivered = false;
    for (const chatId of this.adminChats()) {
      const sent = await this.sendMessage(chatId, text, {
        link_preview_options: { is_disabled: true },
        ...extra,
      });
      if (sent?.message_id) delivered = true;
    }
    return delivered;
  }

  /** Кнопки «Одобрить / Отказать» под заявкой на возврат. */
  private async handleCallback(
    cb: NonNullable<TelegramUpdate['callback_query']>,
  ): Promise<{ handled: boolean; action?: string }> {
    const chatId = cb.message?.chat.id;
    const data = cb.data ?? '';
    if (!data.startsWith('rf:') || chatId === undefined) {
      await this.answerCallbackQuery(cb.id);
      return { handled: false };
    }
    if (!this.isAdminChat(chatId) || !this.refundDesk) {
      await this.answerCallbackQuery(cb.id, 'Нет прав', true);
      return { handled: true, action: 'refund_forbidden' };
    }
    const [, decision, ref] = data.split(':');
    try {
      const result = await this.refundDesk.decide(ref ?? '', decision === 'y');
      await this.answerCallbackQuery(cb.id, decision === 'y' ? 'Возврат оформлен' : 'Отказано');
      if (cb.message?.message_id) {
        const original = (cb.message as { text?: string }).text ?? '';
        await this.editMessageText(
          chatId,
          cb.message.message_id,
          `${escapeHtml(original)}\n\n<b>${escapeHtml(result)}</b>`,
        );
      }
      return { handled: true, action: decision === 'y' ? 'refund_approved' : 'refund_declined' };
    } catch (error) {
      await this.answerCallbackQuery(
        cb.id,
        error instanceof Error ? error.message : 'Не получилось',
        true,
      );
      return { handled: true, action: 'refund_failed' };
    }
  }

  get botUsername(): string {
    return this.username;
  }

  get isConfigured(): boolean {
    return Boolean(this.token && this.token.length > 10);
  }

  async callApi<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | null> {
    if (!this.isConfigured) {
      console.log(`[SupportBot:mock] ${method}:`, JSON.stringify(body));
      return { ok: true, result: {} } as unknown as T;
    }

    try {
      const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { ok: boolean; result?: T; description?: string };
      if (!data.ok) {
        console.error(`[SupportBot] Error in ${method}:`, data.description);
        return null;
      }
      return data.result as T;
    } catch (error) {
      console.error(`[SupportBot] Network error in ${method}:`, error);
      return null;
    }
  }

  async sendMessage(
    chatId: number | string,
    text: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ message_id: number } | null> {
    return this.callApi<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...extra,
    });
  }

  async copyMessage(
    targetChatId: number | string,
    fromChatId: number | string,
    messageId: number,
    extra: Record<string, unknown> = {},
  ): Promise<{ message_id: number } | null> {
    return this.callApi<{ message_id: number }>('copyMessage', {
      chat_id: targetChatId,
      from_chat_id: fromChatId,
      message_id: messageId,
      ...extra,
    });
  }

  async forwardMessage(
    targetChatId: number | string,
    fromChatId: number | string,
    messageId: number,
  ): Promise<{ message_id: number } | null> {
    return this.callApi<{ message_id: number }>('forwardMessage', {
      chat_id: targetChatId,
      from_chat_id: fromChatId,
      message_id: messageId,
    });
  }

  /**
   * Инициализация support бота: проверка токена, установка команд, вебхук / long-polling.
   */
  async initRuntime(publicBaseUrl?: string): Promise<void> {
    if (!this.isConfigured) {
      console.log('🤖 [SupportBot] Бот не сконфигурирован (нет токена), режим заглушки');
      return;
    }

    try {
      const me = await this.callApi<{ id: number; username: string }>('getMe', {});
      if (!me) {
        console.warn(
          '⚠️ [SupportBot] Токен Telegram Support Bot не авторизован (401 / неверный токен). Проверьте токен в @BotFather для бота @ketner_support_bot.',
        );
        return;
      }

      if (me.username) {
        this.username = me.username;
        console.log(`🤖 [SupportBot] Авторизован бот поддержки: @${this.username}`);
      }

      await this.callApi('setMyCommands', {
        commands: [
          { command: 'start', description: 'Связаться с поддержкой Ketner AI' },
          { command: 'tickets', description: 'Список обращений (администратор)' },
          { command: 'close', description: 'Закрыть текущее обращение' },
          { command: 'status', description: 'Статус моего обращения' },
          { command: 'help', description: 'Помощь и контакты' },
        ],
      });

      await this.callApi('setMyDescription', {
        description:
          '💬 Официальная служба поддержки Ketner AI.\n\nЗадайте любой вопрос, отправьте жалобу, скриншот или предложение — наш администратор оперативно ответит вам прямо в этом чате.',
      });

      const effectiveBaseUrl =
        config.telegramWebhookUrl ||
        process.env.RENDER_EXTERNAL_URL ||
        publicBaseUrl ||
        config.betterAuthUrl;

      const isHttps = effectiveBaseUrl && effectiveBaseUrl.startsWith('https://');

      if (isHttps) {
        const webhookUrl = `${effectiveBaseUrl.replace(/\/$/, '')}/api/telegram/support/webhook`;
        const res = await this.callApi<{ ok: boolean }>('setWebhook', {
          url: webhookUrl,
          secret_token: config.telegramSupportWebhookSecret,
          allowed_updates: ['message', 'callback_query'],
        });
        if (res) {
          console.log(`✅ [SupportBot] Webhook успешно зарегистрирован на: ${webhookUrl}`);
          return;
        }
        console.warn(
          '⚠️ [SupportBot] Не удалось установить Webhook, переключаемся на long-polling...',
        );
      }

      console.log('⚡ [SupportBot] Запуск фонового long-polling...');
      // Удаляем старый вебхук перед началом getUpdates, чтобы избежать 409 Conflict
      await this.callApi('deleteWebhook', { drop_pending_updates: false });
      this.startLongPolling();
    } catch (error) {
      console.error('⚠️ [SupportBot] Ошибка инициализации support бота:', error);
    }
  }

  private startLongPolling(): void {
    if (this.isPolling) return;
    this.isPolling = true;
    let offset = 0;

    const poll = async () => {
      while (this.isPolling) {
        try {
          const res = await this.callApi<TelegramUpdate[]>('getUpdates', {
            offset,
            timeout: 25,
            allowed_updates: ['message', 'callback_query'],
          });

          if (Array.isArray(res) && res.length > 0) {
            for (const update of res) {
              offset = update.update_id + 1;
              await this.processUpdate(update);
            }
          }
        } catch (err) {
          console.error('[SupportBot] Polling loop error:', err);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    };

    void poll();
  }

  /**
   * Обработка входящего обновления от пользователя или администратора.
   */
  async processUpdate(update: TelegramUpdate): Promise<{ handled: boolean; action?: string }> {
    if (update.callback_query) return this.handleCallback(update.callback_query);
    if (!update.message) {
      return { handled: false };
    }

    const msg = update.message;
    const chatId = msg.chat.id;
    const fromUser = msg.from;
    const fromUsername = fromUser?.username?.toLowerCase().replace(/^@/, '');

    const hasMedia = Boolean(msg.photo || msg.document || msg.video || msg.voice || msg.sticker);
    const mediaTypeLabel = msg.photo
      ? '📷 [Фотография / Скриншот]'
      : msg.document
        ? `📎 [Файл: ${msg.document.file_name || 'документ'}]`
        : msg.voice
          ? '🎤 [Голосовое сообщение]'
          : msg.video
            ? '📹 [Видео]'
            : msg.sticker
              ? '🎨 [Стикер]'
              : '';

    const text = (msg.text || msg.caption || mediaTypeLabel).trim();

    // Проверяем, является ли отправитель администратором
    // Username в Telegram можно сменить, и его займёт другой человек. Если чат администратора
    // закреплён (SUPPORT_ADMIN_CHAT_ID), права даёт только он, а username больше не учитывается.
    const isConfiguredAdmin = this.pinnedAdminChatId
      ? String(chatId) === String(this.pinnedAdminChatId)
      : Boolean(fromUsername && fromUsername === this.adminUsername);
    const isSavedAdmin = Boolean(!this.pinnedAdminChatId && this.isAdminChat(chatId));
    const isAdmin = isConfiguredAdmin || isSavedAdmin;

    // -------------------------------------------------------------
    // А. ОБРАБОТКА СООБЩЕНИЙ ОТ АДМИНИСТРАТОРА (@gumieeel)
    // -------------------------------------------------------------
    if (isAdmin) {
      // Автоматически фиксируем/обновляем chatId администратора
      if (String(this.store.getAdminChatId()) !== String(chatId)) {
        this.store.setAdminChatId(chatId);
      }

      // Команда /start или /admin
      if (text.startsWith('/start') || text === '/admin') {
        const openTickets = this.store.listOpenTickets();
        const welcomeAdmin = [
          `👑 <b>Здравствуйте, администратор @${this.adminUsername}!</b>`,
          '',
          'Вы успешно авторизованы в качестве главного оператора поддержки <b>Ketner AI</b>.',
          'Сюда поступают обращения в поддержку, заявки на возврат, новые оплаты и сообщения с сайта.',
          '',
          `📋 <b>Открытых обращений:</b> ${openTickets.length}`,
          '',
          '✍️ <b>Как отвечать пользователю:</b>',
          '• <b>Reply (Ответить)</b>: просто сделайте ответ на сообщение бота с тикетом в этом чате.',
          '• <b>Команда</b>: <code>/reply &lt;ID&gt; &lt;текст&gt;</code>',
          '',
          '💡 <b>Команды оператора:</b>',
          '/tickets — список открытых обращений',
          '/refunds — заявки на возврат',
          '/close &lt;ID&gt; — закрыть обращение',
          '/status — системная информация',
        ].join('\n');

        await this.sendMessage(chatId, welcomeAdmin);
        return { handled: true, action: 'admin_welcome_sent' };
      }

      // Команда /status
      if (text === '/status') {
        const openTickets = this.store.listOpenTickets();
        const allTickets = this.store.listAllTickets();
        const statusMsg = [
          '⚙️ <b>Статус поддержки Ketner AI:</b>',
          `• Бот: @${this.username}`,
          `• Админ: @${this.adminUsername}`,
          `• Chat ID админа: <code>${chatId}</code>`,
          `• Открытых тикетов: <b>${openTickets.length}</b>`,
          `• Всего обращений: <b>${allTickets.length}</b>`,
        ].join('\n');

        await this.sendMessage(chatId, statusMsg);
        return { handled: true, action: 'admin_status_sent' };
      }

      // Команда /refunds — открытые заявки на возврат
      if (text === '/refunds') {
        await this.sendMessage(
          chatId,
          this.refundDesk ? this.refundDesk.pendingSummary() : 'Заявки на возврат недоступны.',
        );
        return { handled: true, action: 'admin_refunds_list_sent' };
      }

      // Reply на заявку о возврате: ответ уходит клиенту в бот оплаты и в кабинет
      if (msg.reply_to_message && this.refundDesk) {
        const replied = msg.reply_to_message;
        const ref =
          this.store.getRefundRefByAdminMessageId(replied.message_id) ??
          REFUND_TAG.exec(replied.text ?? replied.caption ?? '')?.[1];
        if (ref) {
          if (!msg.text || hasMedia) {
            await this.sendMessage(chatId, 'По заявке на возврат можно ответить только текстом.');
            return { handled: true, action: 'admin_refund_reply_media' };
          }
          try {
            const customer = await this.refundDesk.reply(ref, msg.text.trim());
            await this.sendMessage(
              chatId,
              `✅ Ответ по заявке <code>R-${escapeHtml(ref)}</code> отправлен клиенту ${escapeHtml(customer)}. Он увидит его в боте оплаты и в кабинете.`,
            );
            return { handled: true, action: 'admin_refund_reply_delivered' };
          } catch (error) {
            await this.sendMessage(
              chatId,
              `❌ ${escapeHtml(error instanceof Error ? error.message : 'Не получилось отправить ответ')}`,
            );
            return { handled: true, action: 'admin_refund_reply_failed' };
          }
        }
      }

      // Команда /tickets — список открытых обращений
      if (text === '/tickets') {
        const openTickets = this.store.listOpenTickets();
        if (openTickets.length === 0) {
          await this.sendMessage(chatId, '✅ Нет открытых обращений. Все вопросы решены!');
          return { handled: true, action: 'admin_tickets_empty' };
        }

        let ticketsList = `📋 <b>Открытые обращения (${openTickets.length}):</b>\n\n`;
        for (const t of openTickets) {
          const lastMsg = t.messages[t.messages.length - 1];
          const userHandle = t.userUsername ? `@${t.userUsername}` : t.userFirstName || 'Аноним';
          const preview = lastMsg?.text ? lastMsg.text.slice(0, 80) : '—';
          // Имя в Telegram задаёт сам пользователь: без экранирования оно вставило бы в чат
          // администратора свою разметку (ссылку) или сломало бы отправку всего списка.
          ticketsList += `🔹 <b>Тикет #${t.id}</b> от ${escapeHtml(userHandle)} (ID: <code>${t.userChatId}</code>)\n`;
          ticketsList += `   <i>«${escapeHtml(preview)}»</i>\n`;
          ticketsList += `   👉 Ответить: <code>/reply ${t.id} текст</code>\n\n`;
        }

        await this.sendMessage(chatId, ticketsList);
        return { handled: true, action: 'admin_tickets_list_sent' };
      }

      // Команда /close <ticketId>
      if (text.startsWith('/close')) {
        const targetId = text.replace('/close', '').trim();
        let ticket: SupportTicket | undefined;

        if (targetId) {
          ticket = this.store.getTicket(targetId) || this.store.getTicket(`T-${targetId}`);
        } else if (msg.reply_to_message) {
          ticket = this.store.getTicketByAdminMessageId(msg.reply_to_message.message_id);
        }

        if (!ticket) {
          await this.sendMessage(
            chatId,
            '❌ Укажите ID тикета: <code>/close T-1001</code> или сделайте Reply на сообщение тикета.',
          );
          return { handled: true, action: 'admin_close_not_found' };
        }

        this.store.closeTicket(ticket.id);
        await this.sendMessage(chatId, `✅ Тикет <b>#${ticket.id}</b> успешно закрыт.`);

        // Уведомляем пользователя о закрытии тикета
        await this.sendMessage(
          ticket.userChatId,
          `ℹ️ Ваше обращение <b>#${ticket.id}</b> отмечено как решённое оператором.\nЕсли у вас возникнут новые вопросы, просто напишите сообщение в этот чат!`,
        );
        return { handled: true, action: 'admin_ticket_closed' };
      }

      // Команда /reply <ticketId> <ответ>
      if (text.startsWith('/reply')) {
        const parts = text.replace('/reply', '').trim().split(' ');
        const ticketParam = parts[0];
        const replyText = parts.slice(1).join(' ').trim();

        if (!ticketParam || !replyText) {
          await this.sendMessage(
            chatId,
            '❌ Формат команды: <code>/reply T-1001 Ваш текст ответа</code>',
          );
          return { handled: true, action: 'admin_reply_invalid_format' };
        }

        const ticket =
          this.store.getTicket(ticketParam) ||
          this.store.getTicket(`T-${ticketParam}`) ||
          this.store.getActiveTicketForUser(ticketParam);

        if (!ticket) {
          await this.sendMessage(chatId, `❌ Тикет <b>${ticketParam}</b> не найден.`);
          return { handled: true, action: 'admin_reply_ticket_not_found' };
        }

        return this.deliverAdminReply(ticket, replyText, chatId, msg);
      }

      // Нативный Reply администратора на сообщение тикета
      if (msg.reply_to_message) {
        const repliedMsgId = msg.reply_to_message.message_id;
        const ticket = this.store.getTicketByAdminMessageId(repliedMsgId);

        if (ticket) {
          return this.deliverAdminReply(ticket, text, chatId, msg);
        }
      }

      // Если администратор написал текст без Reply и без команды
      await this.sendMessage(
        chatId,
        '💡 Чтобы ответить пользователю, сделайте <b>Reply (Ответить)</b> на сообщение с тикетом или используйте команду:\n<code>/reply &lt;ID тикета&gt; &lt;текст ответа&gt;</code>',
      );
      return { handled: true, action: 'admin_tip_sent' };
    }

    // -------------------------------------------------------------
    // Б. ОБРАБОТКА СООБЩЕНИЙ ОТ ОБЫЧНЫХ ПОЛЬЗОВАТЕЛЕЙ (ЖАЛОБЫ, ВОПРОСЫ)
    // -------------------------------------------------------------
    if (text === '/start') {
      const userGreeting = [
        `👋 <b>Здравствуйте, ${escapeHtml(fromUser?.first_name || 'друг')}!</b>`,
        '',
        'Это официальная служба поддержки <b>Ketner AI</b>.',
        '',
        'Опишите вашу проблему, задайте вопрос или отправьте скриншот прямо в этот чат. Наш администратор оперативно получит ваше обращение и ответит вам прямо сюда.',
      ].join('\n');

      await this.sendMessage(chatId, userGreeting);
      return { handled: true, action: 'user_greeting_sent' };
    }

    if (text === '/help') {
      await this.sendMessage(
        chatId,
        'ℹ️ <b>Служба поддержки Ketner AI</b>\n\nПросто отправьте текстовое сообщение или файл с описанием вашей ситуации, и оператор ответит вам в этом диалоге.\n\nКоманда /close — закрыть текущее обращение.',
      );
      return { handled: true, action: 'user_help_sent' };
    }

    if (text === '/status') {
      const activeTicket = this.store.getActiveTicketForUser(chatId);
      if (!activeTicket) {
        await this.sendMessage(
          chatId,
          'У вас нет активных обращений. Напишите ваш вопрос, чтобы создать новое!',
        );
      } else {
        await this.sendMessage(
          chatId,
          `📋 Ваше текущее обращение: <b>#${activeTicket.id}</b> (статус: <b>В обработке</b>).\nСообщений в диалоге: ${activeTicket.messages.length}`,
        );
      }
      return { handled: true, action: 'user_status_sent' };
    }

    if (text === '/close') {
      const activeTicket = this.store.getActiveTicketForUser(chatId);
      if (!activeTicket) {
        await this.sendMessage(chatId, 'У вас нет активных обращений.');
        return { handled: true, action: 'user_close_none' };
      }
      this.store.closeTicket(activeTicket.id);
      await this.sendMessage(
        chatId,
        `✅ Ваше обращение <b>#${activeTicket.id}</b> успешно закрыто. Если появятся вопросы — пишите!`,
      );

      await this.notifyAdmins(`ℹ️ Пользователь закрыл обращение <b>#${activeTicket.id}</b>.`);
      return { handled: true, action: 'user_ticket_closed' };
    }

    if (!text && !hasMedia) {
      return { handled: false };
    }

    // Находим активный тикет или создаем новый
    let ticket = this.store.getActiveTicketForUser(chatId);
    let isNewTicket = false;

    if (!ticket) {
      isNewTicket = true;
      ticket = this.store.createTicket({
        userChatId: chatId,
        userUsername: fromUser?.username,
        userFirstName: fromUser?.first_name,
        userLastName: fromUser?.last_name,
        text,
        telegramMessageId: msg.message_id,
      });
    } else {
      this.store.addMessageToTicket(ticket.id, {
        from: 'user',
        senderName: fromUser?.first_name || fromUser?.username || 'Пользователь',
        text,
        telegramMessageId: msg.message_id,
      });
    }

    // Подтверждение пользователю
    const ackText = isNewTicket
      ? `✅ <b>Ваше обращение принято (Тикет #${ticket.id})!</b>\n\nОператор поддержки уже получил ваше сообщение и скоро ответит вам прямо в этом чате.`
      : `✅ Сообщение добавлено к вашему обращению <b>#${ticket.id}</b>. Ожидайте ответа оператора.`;

    await this.sendMessage(chatId, ackText);

    // Доставка уведомления администратору (@gumieeel)
    const adminChats = this.adminChats();
    for (const adminChatId of adminChats) {
      const senderTitle = fromUser?.username
        ? `@${fromUser.username}`
        : `${fromUser?.first_name || ''} ${fromUser?.last_name || ''}`.trim() || 'Пользователь';

      const adminNotice = [
        `📩 <b>Новое сообщение в поддержку!</b>`,
        `Тикет: <b>#${ticket.id}</b>`,
        `От: <b>${escapeHtml(senderTitle)}</b> (ID: <code>${chatId}</code>)`,
        '',
        `«${escapeHtml(text)}»`,
        '',
        '✍️ <i>Ответьте на это сообщение (Reply) для ответа, либо:</i>',
        `<code>/reply ${ticket.id} текст ответа</code>`,
      ].join('\n');

      const sentMsg = await this.sendMessage(adminChatId, adminNotice);
      if (sentMsg?.message_id) {
        this.store.linkAdminNotification(ticket.id, sentMsg.message_id);
      }

      // Если пользователь прислал медиафайл (фото, чек, скриншот, документ), дублируем его админу
      if (hasMedia) {
        const copied = await this.copyMessage(adminChatId, chatId, msg.message_id);
        if (copied?.message_id) {
          this.store.linkAdminNotification(ticket.id, copied.message_id);
        }
      }
    }
    if (adminChats.length === 0) {
      console.log(
        `[SupportBot] Обращение #${ticket.id} сохранено, но чат администратора неизвестен: задайте SUPPORT_ADMIN_CHAT_ID или привяжите Telegram администратора на сайте.`,
      );
    }

    return { handled: true, action: 'user_ticket_message_processed' };
  }

  /**
   * Доставка ответа администратора пользователю в Telegram.
   */
  private async deliverAdminReply(
    ticket: SupportTicket,
    replyText: string,
    adminChatId: number | string,
    adminMsg?: TelegramUpdate['message'],
  ): Promise<{ handled: boolean; action: string }> {
    // Сохраняем в истории тикета
    this.store.addMessageToTicket(ticket.id, {
      from: 'admin',
      senderName: `@${this.adminUsername}`,
      text: replyText,
    });

    const hasMedia = Boolean(
      adminMsg && (adminMsg.photo || adminMsg.document || adminMsg.video || adminMsg.voice),
    );

    // Если админ ответил медиафайлом (скриншот, документ), копируем его пользователю
    if (adminMsg && hasMedia) {
      await this.copyMessage(ticket.userChatId, adminChatId, adminMsg.message_id);
      if (replyText && !replyText.startsWith('📷') && !replyText.startsWith('📎')) {
        await this.sendMessage(
          ticket.userChatId,
          `💬 <b>Ответ оператора Ketner AI:</b>\n\n${escapeHtml(replyText)}`,
        );
      }
    } else {
      // Отправляем текстовое сообщение пользователю
      const userMessage = [
        '💬 <b>Ответ службы поддержки Ketner AI:</b>',
        '',
        escapeHtml(replyText),
        '',
        '<i>(Вы можете продолжить диалог, просто ответив в этот чат)</i>',
      ].join('\n');

      await this.sendMessage(ticket.userChatId, userMessage);
    }

    // Подтверждаем администратору
    const userDisplay = ticket.userUsername ? `@${ticket.userUsername}` : `ID ${ticket.userChatId}`;
    await this.sendMessage(
      adminChatId,
      `✅ Ответ успешно отправлен пользователю <b>${escapeHtml(userDisplay)}</b> (Тикет <b>#${ticket.id}</b>)!`,
    );

    return { handled: true, action: 'admin_reply_delivered' };
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export const telegramSupportBotService = new TelegramSupportBotService();
