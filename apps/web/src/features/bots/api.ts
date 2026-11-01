import { API_BASE } from '@/lib/api-config';
import { storage } from '@/lib/storage';

/**
 * Публичный клиент бота для клиентов (`/api/b/:slug`, docs/api.md): без входа и без токена —
 * страница открывается у посетителей бизнеса и во фрейме на чужих сайтах. Посетитель — случайный
 * id в его браузере; если хранилище недоступно (фрейм с запретом сторонних данных), id живёт до
 * перезагрузки страницы.
 */

export interface PublicBot {
  slug: string;
  name: string;
  greeting: string;
  quickReplies: string[];
  language: 'ru' | 'en';
  status: 'active' | 'paused';
}

export interface PublicBotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  offerContact: boolean;
  status: 'complete' | 'error';
  createdAt: string;
}

export class BotApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const VISITOR_KEY = 'bot_visitor';
let memoryVisitor: string | null = null;

function randomId(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}

export function visitorId(): string {
  const stored = storage.get(VISITOR_KEY);
  if (stored && /^v_[a-z0-9]{12,40}$/.test(stored)) return stored;
  memoryVisitor ??= `v_${randomId(24)}`;
  storage.set(VISITOR_KEY, memoryVisitor);
  return memoryVisitor;
}

/** Диалог этого посетителя с этим ботом: после перезагрузки переписка восстанавливается. */
export const conversationStore = {
  get(slug: string): string | null {
    return storage.get(`bot_conversation.${slug}`);
  },
  set(slug: string, id: string): void {
    storage.set(`bot_conversation.${slug}`, id);
  },
  clear(slug: string): void {
    storage.remove(`bot_conversation.${slug}`);
  },
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/b${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
    });
  } catch {
    throw new BotApiError('network_error', '', 0);
  }
  const body = (await response.json().catch(() => null)) as
    (T & { error?: { code?: string; message?: string } }) | null;
  if (!response.ok) {
    throw new BotApiError(
      body?.error?.code ?? 'unknown_error',
      body?.error?.message ?? '',
      response.status,
    );
  }
  return body as T;
}

const enc = encodeURIComponent;

export async function fetchPublicBot(slug: string): Promise<PublicBot> {
  return (await call<{ bot: PublicBot }>(`/${enc(slug)}`)).bot;
}

export async function fetchHistory(
  slug: string,
  conversationId: string,
): Promise<PublicBotMessage[]> {
  return (
    await call<{ messages: PublicBotMessage[] }>(
      `/${enc(slug)}/conversations/${enc(conversationId)}?visitorId=${enc(visitorId())}`,
    )
  ).messages;
}

export function sendBotMessage(
  slug: string,
  content: string,
  conversationId: string | null,
): Promise<{ conversationId: string; message: PublicBotMessage }> {
  return call(`/${enc(slug)}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      visitorId: visitorId(),
      ...(conversationId ? { conversationId } : {}),
      content,
    }),
  });
}

export async function sendLead(
  slug: string,
  lead: { name: string; contact: string; question: string },
  conversationId: string | null,
): Promise<void> {
  await call(`/${enc(slug)}/leads`, {
    method: 'POST',
    body: JSON.stringify({
      visitorId: visitorId(),
      ...(conversationId ? { conversationId } : {}),
      ...lead,
    }),
  });
}
