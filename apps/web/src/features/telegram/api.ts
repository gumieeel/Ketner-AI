import { ApiError } from '../chat/api';
import { API_BASE } from '@/lib/api-config';
import type { PlanId } from '../billing/types';

export { ApiError };

/** Прежние подписки (у платежей и автопродления до перехода на кредиты). */
export type PaidPlanId = Exclude<PlanId, 'free' | 'credits'>;

/** Пакет кредитов в кабинете: цена в звёздах уже посчитана сервером по курсу Telegram. */
export interface MiniAppPack {
  id: string;
  priceUsd: number;
  credits: number;
  stars: number;
  /** Сколько эти звёзды стоят по официальному курсу Telegram, $. */
  starsUsd: number;
  /** Цена за 1 000 кредитов, $. */
  pricePerThousandUsd: number;
}

export interface MiniAppCredits {
  /** Остаток, кредиты. */
  balance: number;
  /** Пробные кредиты, которые даются один раз. */
  trialCredits: number;
  /** Сколько дней действует купленный пакет. */
  validDays: number;
}

export type PaymentStatus = 'paid' | 'refund_requested' | 'refunded' | 'refund_declined';
export type RefundOption =
  | { kind: 'auto' }
  | { kind: 'request' }
  | { kind: 'none'; reason: 'refunded' | 'pending' | 'declined' | 'expired' | 'used' };

export interface MiniAppPayment {
  id: string;
  method: 'stars' | 'crypto';
  planId: PaidPlanId;
  /** Что оплачено: «2 300 кредитов» у пакета, название тарифа у прежней подписки. */
  planTitle: string;
  /** Пакет кредитов, если платёж за него. */
  packId?: string;
  amount: number;
  currency: 'XTR' | 'USD';
  paidAt: string;
  status: PaymentStatus;
  recurring: boolean;
  periodEnd: string | null;
  bonusDays: number;
  chargeId: string | null;
  refund: {
    requestedAt?: string;
    reason?: string;
    comment?: string;
    decidedAt?: string;
    auto?: boolean;
    note?: string;
    /** Переписка с поддержкой по заявке. */
    messages?: Array<{ from: 'user' | 'admin'; text: string; at: string }>;
  } | null;
  refundOption: RefundOption;
}

export interface MiniAppState {
  user: {
    id: string;
    /** null — аккаунт создан через Telegram (почты нет). */
    email: string | null;
    name: string;
    plan: PlanId;
    isVip: boolean;
    isAdmin: boolean;
    createdAt: string;
    telegramUsername: string | null;
    telegramOnly: boolean;
  };
  subscription: {
    plan: PlanId;
    status: 'active' | 'trialing' | 'past_due' | 'canceled';
    renewsAt: string | null;
  };
  autoRenew: {
    planId: PaidPlanId;
    status: 'active' | 'canceled';
    stars: number;
    nextChargeAt: string | null;
  } | null;
  /** Остаток кредитов и условия пробных. */
  credits: MiniAppCredits;
  packs: MiniAppPack[];
  /** Курс цены в звёздах (официальный Telegram) и рыночный курс Fragment для сравнения. */
  rate: {
    usdPerStar: number;
    source: 'official' | 'config';
    updatedAt: string;
    market: { usdPerStar: number; updatedAt: string } | null;
  };
  payments: MiniAppPayment[];
  prefs: { reminders: boolean; receipts: boolean };
  /** Возврат — в течение стольких часов после оплаты и только без запросов к моделям. */
  refundPolicy: { hours: number };
  pendingRefunds: number;
  siteUrl: string;
  botUsername: string;
}

export type MiniAppSession =
  | ({ linked: true; token: string; expiresAt: string } & MiniAppState)
  | {
      linked: false;
      telegram: { firstName: string; username: string | null };
      siteUrl: string;
      /** Прежний аккаунт, созданный через Telegram, из которого человек вышел. */
      previousAccount?: { name: string; plan: string } | null;
    };

export interface AdminRefund extends MiniAppPayment {
  /** Сколько раз модели ответили клиенту после оплаты. */
  usedRequests: number;
  customer: { name: string; email: string | null; telegramUsername: string | null } | null;
}

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const response = await fetch(`${API_BASE}/telegram/miniapp${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    let code = 'unknown_error';
    let message = `Запрос завершился со статусом ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // не JSON
    }
    throw new ApiError(code, message, response.status);
  }
  return (await response.json()) as T;
}

const enc = encodeURIComponent;

/** API кабинета в Telegram: вход по initData, затем обычный токен сессии сайта. */
export const miniAppApi = {
  session: (initData: string) => call<MiniAppSession>('/session', { body: { initData } }),
  /** Вернуться в прежний аккаунт Telegram после выхода. */
  restore: (initData: string) => call<MiniAppSession>('/restore', { body: { initData } }),
  /** Привязка по коду из письма: шаг 1 — письмо с кодом на почту аккаунта. */
  emailCode: (initData: string, email: string) =>
    call<{ sent: true; expiresAt: number; resendAfterSec: number }>('/email-code', {
      body: { initData, email },
    }),
  /** Шаг 2 — код из письма привязывает этот Telegram к аккаунту. */
  emailVerify: (initData: string, code: string) =>
    call<MiniAppSession>('/email-verify', { body: { initData, code } }),
  link: (initData: string, email: string, password: string) =>
    call<MiniAppSession>('/link', { body: { initData, email, password } }),
  linkCode: (initData: string) =>
    call<{ code: string; expiresAt: number }>('/link-code', { body: { initData } }),
  state: (token: string) => call<MiniAppState>('/state', { token }),
  /** Счёт в звёздах на пакет кредитов. */
  invoice: (token: string, packId: string) =>
    call<{ invoiceId: string; link: string; stars: number }>('/invoice', {
      token,
      body: { packId },
    }),
  invoiceStatus: (token: string, invoiceId: string) =>
    call<{ status: 'pending' | 'paid' | 'expired' }>(`/invoice/${enc(invoiceId)}`, { token }),
  /** Отключить автопродление прежней подписки (включить его заново нельзя). */
  autoRenew: (token: string, enabled: boolean) =>
    call<MiniAppState>('/auto-renew', { token, body: { enabled } }),
  refund: (token: string, paymentId: string, reason: string, comment: string) =>
    call<{ outcome: 'refunded' | 'requested' } & MiniAppState>(
      `/payments/${enc(paymentId)}/refund`,
      {
        token,
        body: { reason, comment },
      },
    ),
  /** Сообщение поддержке по своей заявке на возврат. */
  refundMessage: (token: string, paymentId: string, text: string) =>
    call<MiniAppState>(`/payments/${enc(paymentId)}/refund/message`, { token, body: { text } }),
  /** Удалить чек из истории (только администратор). */
  deletePayment: (token: string, paymentId: string) =>
    call<MiniAppState>(`/payments/${enc(paymentId)}`, { token, method: 'DELETE' }),
  prefs: (token: string, prefs: Partial<MiniAppState['prefs']>) =>
    call<MiniAppState>('/prefs', { token, body: prefs }),
  unlink: (token: string) => call<{ ok: boolean }>('/unlink', { token, body: {} }),
  adminRefunds: (token: string) => call<{ refunds: AdminRefund[] }>('/admin/refunds', { token }),
  adminDecide: (token: string, paymentId: string, approve: boolean, note: string) =>
    call<{ payment: MiniAppPayment }>(`/admin/refunds/${enc(paymentId)}`, {
      token,
      body: { approve, note },
    }),
};
