import crypto from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';

export interface SupportMessage {
  id: string;
  from: 'user' | 'admin';
  senderName: string;
  text: string;
  timestamp: string;
  telegramMessageId?: number;
}

export interface SupportTicket {
  id: string;
  userChatId: number | string;
  userUsername?: string;
  userFirstName?: string;
  userLastName?: string;
  status: 'open' | 'closed';
  messages: SupportMessage[];
  createdAt: string;
  updatedAt: string;
  adminNotificationMessageId?: number;
}

export interface SupportStore {
  getAdminChatId(): number | string | undefined;
  setAdminChatId(chatId: number | string): void;
  getTicket(id: string): SupportTicket | undefined;
  getTicketByAdminMessageId(msgId: number): SupportTicket | undefined;
  getActiveTicketForUser(userChatId: number | string): SupportTicket | undefined;
  createTicket(params: {
    userChatId: number | string;
    userUsername?: string;
    userFirstName?: string;
    userLastName?: string;
    text: string;
    telegramMessageId?: number;
  }): SupportTicket;
  addMessageToTicket(
    ticketId: string,
    message: Omit<SupportMessage, 'id' | 'timestamp'>,
  ): SupportTicket | undefined;
  linkAdminNotification(ticketId: string, adminMessageId: number): void;
  closeTicket(ticketId: string): SupportTicket | undefined;
  listOpenTickets(): SupportTicket[];
  listAllTickets(): SupportTicket[];
}

interface SupportSnapshot {
  adminChatId?: number | string;
  tickets: SupportTicket[];
  adminMessageMap: Array<[number, string]>; // [msgId, ticketId]
}

function readSnapshot(file: string): SupportSnapshot {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<SupportSnapshot>;
    return {
      adminChatId: parsed.adminChatId,
      tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [],
      adminMessageMap: Array.isArray(parsed.adminMessageMap) ? parsed.adminMessageMap : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[mock-api] хранилище поддержки не прочитано, начинаем с пустого:', error);
    }
    return { tickets: [], adminMessageMap: [] };
  }
}

function writeSnapshot(file: string, snapshot: SupportSnapshot): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    renameSync(temporary, file);
  } catch (error) {
    console.error('[mock-api] Ошибка записи хранилища поддержки:', error);
  }
}

export function createSupportStore(file?: string): SupportStore {
  let adminChatId: number | string | undefined;
  const tickets = new Map<string, SupportTicket>();
  const adminMsgToTicketId = new Map<number, string>();

  if (file) {
    const snapshot = readSnapshot(file);
    adminChatId = snapshot.adminChatId;
    for (const t of snapshot.tickets) {
      tickets.set(t.id, t);
    }
    for (const [msgId, ticketId] of snapshot.adminMessageMap) {
      adminMsgToTicketId.set(msgId, ticketId);
    }
  }

  const persist = (): void => {
    if (!file) return;
    writeSnapshot(file, {
      adminChatId,
      tickets: Array.from(tickets.values()),
      adminMessageMap: Array.from(adminMsgToTicketId.entries()),
    });
  };

  return {
    getAdminChatId(): number | string | undefined {
      return adminChatId;
    },

    setAdminChatId(chatId: number | string): void {
      adminChatId = chatId;
      persist();
    },

    getTicket(id: string): SupportTicket | undefined {
      return tickets.get(id);
    },

    getTicketByAdminMessageId(msgId: number): SupportTicket | undefined {
      const ticketId = adminMsgToTicketId.get(msgId);
      if (!ticketId) return undefined;
      return tickets.get(ticketId);
    },

    getActiveTicketForUser(userChatId: number | string): SupportTicket | undefined {
      // Ищем последнее открытое обращение от этого пользователя
      const all = Array.from(tickets.values());
      for (let i = all.length - 1; i >= 0; i--) {
        const t = all[i];
        if (String(t.userChatId) === String(userChatId) && t.status === 'open') {
          return t;
        }
      }
      return undefined;
    },

    createTicket(params: {
      userChatId: number | string;
      userUsername?: string;
      userFirstName?: string;
      userLastName?: string;
      text: string;
      telegramMessageId?: number;
    }): SupportTicket {
      const ticketNum = 1000 + tickets.size + 1;
      const id = `T-${ticketNum}`;
      const now = new Date().toISOString();

      const initialMessage: SupportMessage = {
        id: `msg_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
        from: 'user',
        senderName: params.userFirstName || params.userUsername || 'Пользователь',
        text: params.text,
        timestamp: now,
        telegramMessageId: params.telegramMessageId,
      };

      const ticket: SupportTicket = {
        id,
        userChatId: params.userChatId,
        userUsername: params.userUsername,
        userFirstName: params.userFirstName,
        userLastName: params.userLastName,
        status: 'open',
        messages: [initialMessage],
        createdAt: now,
        updatedAt: now,
      };

      tickets.set(id, ticket);
      persist();
      return ticket;
    },

    addMessageToTicket(
      ticketId: string,
      message: Omit<SupportMessage, 'id' | 'timestamp'>,
    ): SupportTicket | undefined {
      const ticket = tickets.get(ticketId);
      if (!ticket) return undefined;

      const fullMessage: SupportMessage = {
        ...message,
        id: `msg_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
        timestamp: new Date().toISOString(),
      };

      ticket.messages.push(fullMessage);
      ticket.updatedAt = fullMessage.timestamp;
      persist();
      return ticket;
    },

    linkAdminNotification(ticketId: string, adminMessageId: number): void {
      const ticket = tickets.get(ticketId);
      if (ticket) {
        ticket.adminNotificationMessageId = adminMessageId;
      }
      adminMsgToTicketId.set(adminMessageId, ticketId);
      persist();
    },

    closeTicket(ticketId: string): SupportTicket | undefined {
      const ticket = tickets.get(ticketId);
      if (!ticket) return undefined;
      ticket.status = 'closed';
      ticket.updatedAt = new Date().toISOString();
      persist();
      return ticket;
    },

    listOpenTickets(): SupportTicket[] {
      return Array.from(tickets.values()).filter((t) => t.status === 'open');
    },

    listAllTickets(): SupportTicket[] {
      return Array.from(tickets.values());
    },
  };
}

export const supportStore = createSupportStore(config.supportStoreFile);
