import crypto from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';
function readSnapshot(file) {
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        return {
            adminChatId: parsed.adminChatId,
            tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [],
            adminMessageMap: Array.isArray(parsed.adminMessageMap) ? parsed.adminMessageMap : [],
        };
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn('[mock-api] хранилище поддержки не прочитано, начинаем с пустого:', error);
        }
        return { tickets: [], adminMessageMap: [] };
    }
}
function writeSnapshot(file, snapshot) {
    try {
        mkdirSync(dirname(file), { recursive: true });
        const temporary = `${file}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
        renameSync(temporary, file);
    }
    catch (error) {
        console.error('[mock-api] Ошибка записи хранилища поддержки:', error);
    }
}
export function createSupportStore(file) {
    let adminChatId;
    const tickets = new Map();
    const adminMsgToTicketId = new Map();
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
    const persist = () => {
        if (!file)
            return;
        writeSnapshot(file, {
            adminChatId,
            tickets: Array.from(tickets.values()),
            adminMessageMap: Array.from(adminMsgToTicketId.entries()),
        });
    };
    return {
        getAdminChatId() {
            return adminChatId;
        },
        setAdminChatId(chatId) {
            adminChatId = chatId;
            persist();
        },
        getTicket(id) {
            return tickets.get(id);
        },
        getTicketByAdminMessageId(msgId) {
            const ticketId = adminMsgToTicketId.get(msgId);
            if (!ticketId)
                return undefined;
            return tickets.get(ticketId);
        },
        getActiveTicketForUser(userChatId) {
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
        createTicket(params) {
            const ticketNum = 1000 + tickets.size + 1;
            const id = `T-${ticketNum}`;
            const now = new Date().toISOString();
            const initialMessage = {
                id: `msg_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
                from: 'user',
                senderName: params.userFirstName || params.userUsername || 'Пользователь',
                text: params.text,
                timestamp: now,
                telegramMessageId: params.telegramMessageId,
            };
            const ticket = {
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
        addMessageToTicket(ticketId, message) {
            const ticket = tickets.get(ticketId);
            if (!ticket)
                return undefined;
            const fullMessage = {
                ...message,
                id: `msg_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
                timestamp: new Date().toISOString(),
            };
            ticket.messages.push(fullMessage);
            ticket.updatedAt = fullMessage.timestamp;
            persist();
            return ticket;
        },
        linkAdminNotification(ticketId, adminMessageId) {
            const ticket = tickets.get(ticketId);
            if (ticket) {
                ticket.adminNotificationMessageId = adminMessageId;
            }
            adminMsgToTicketId.set(adminMessageId, ticketId);
            persist();
        },
        closeTicket(ticketId) {
            const ticket = tickets.get(ticketId);
            if (!ticket)
                return undefined;
            ticket.status = 'closed';
            ticket.updatedAt = new Date().toISOString();
            persist();
            return ticket;
        },
        listOpenTickets() {
            return Array.from(tickets.values()).filter((t) => t.status === 'open');
        },
        listAllTickets() {
            return Array.from(tickets.values());
        },
    };
}
export const supportStore = createSupportStore(config.supportStoreFile);
