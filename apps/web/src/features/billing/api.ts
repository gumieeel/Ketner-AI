import { getAuthToken, useAuth } from '../auth/auth-store';
import { ApiError } from '../chat/api';
import { API_BASE } from '@/lib/api-config';
import type {
  CryptoCurrency,
  CryptoInvoice,
  Plan,
  PlanId,
  SbpInvoice,
  Subscription,
  TelegramStarsInvoice,
} from './types';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function toApiError(response: Response): Promise<ApiError> {
  const fallback = `Запрос завершился со статусом ${response.status}`;
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return new ApiError(
      body.error?.code ?? 'unknown_error',
      body.error?.message ?? fallback,
      response.status,
    );
  } catch {
    return new ApiError('unknown_error', fallback, response.status);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const currentUser = useAuth.getState().user;
  if (currentUser?.email) {
    headers['X-User-Email'] = currentUser.email;
  }
  if (currentUser?.id) {
    headers['X-User-Id'] = currentUser.id;
  }
  if (currentUser?.plan) {
    headers['X-User-Plan'] = currentUser.plan;
  }
  if (init?.headers) {
    Object.assign(headers, init.headers);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function fetchPlans(): Promise<Plan[]> {
  const data = await request<{ plans: Plan[] }>('/plans');
  return data.plans;
}

export async function fetchSubscription(): Promise<Subscription> {
  const data = await request<{ subscription: Subscription }>('/billing/subscription');
  return data.subscription;
}

export async function checkout(
  planId: PlanId,
): Promise<{ subscription: Subscription; user: { plan: PlanId } }> {
  return request<{ subscription: Subscription; user: { plan: PlanId } }>('/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ planId }),
  });
}

export async function cancelSubscription(): Promise<{
  subscription: Subscription;
  user: { plan: PlanId };
}> {
  return request<{ subscription: Subscription; user: { plan: PlanId } }>('/billing/cancel', {
    method: 'POST',
  });
}

// --- СБП ---

export async function createSbpInvoice(planId: PlanId): Promise<{ invoice: SbpInvoice }> {
  return request<{ invoice: SbpInvoice }>('/billing/sbp/create-invoice', {
    method: 'POST',
    body: JSON.stringify({ planId }),
  });
}

export async function getSbpInvoiceStatus(
  invoiceId: string,
): Promise<{ status: string; invoice: SbpInvoice }> {
  return request<{ status: string; invoice: SbpInvoice }>(`/billing/sbp/status/${invoiceId}`);
}

export async function confirmSbpPayment(invoiceId: string): Promise<{
  success: boolean;
  subscription: Subscription;
  user: { plan: PlanId };
  invoice: SbpInvoice;
}> {
  return request<{
    success: boolean;
    subscription: Subscription;
    user: { plan: PlanId };
    invoice: SbpInvoice;
  }>(`/billing/sbp/confirm/${invoiceId}`, {
    method: 'POST',
  });
}

// --- Telegram Stars ---

export async function createTelegramStarsInvoice(
  planId: PlanId,
): Promise<{ invoice: TelegramStarsInvoice }> {
  return request<{ invoice: TelegramStarsInvoice }>('/billing/telegram-stars/create-invoice', {
    method: 'POST',
    body: JSON.stringify({ planId }),
  });
}

export async function getTelegramStarsStatus(
  invoiceId: string,
): Promise<{ status: string; invoice: TelegramStarsInvoice }> {
  return request<{ status: string; invoice: TelegramStarsInvoice }>(
    `/billing/telegram-stars/status/${invoiceId}`,
  );
}

export async function confirmTelegramStarsPayment(invoiceId: string): Promise<{
  success: boolean;
  subscription: Subscription;
  user: { plan: PlanId };
  invoice: TelegramStarsInvoice;
}> {
  return request<{
    success: boolean;
    subscription: Subscription;
    user: { plan: PlanId };
    invoice: TelegramStarsInvoice;
  }>(`/billing/telegram-stars/confirm/${invoiceId}`, {
    method: 'POST',
  });
}

// --- Crypto ---

export async function createCryptoInvoice(
  planId: PlanId,
  currency: CryptoCurrency = 'USDT_TRC20',
): Promise<{ invoice: CryptoInvoice }> {
  return request<{ invoice: CryptoInvoice }>('/billing/crypto/create-invoice', {
    method: 'POST',
    body: JSON.stringify({ planId, currency }),
  });
}

export async function getCryptoInvoiceStatus(
  invoiceId: string,
): Promise<{ status: string; invoice: CryptoInvoice }> {
  return request<{ status: string; invoice: CryptoInvoice }>(
    `/billing/crypto/status/${invoiceId}`,
  );
}

export async function confirmCryptoPayment(
  invoiceId: string,
  txHash?: string,
  mode?: 'gateway' | 'manual',
): Promise<{
  success: boolean;
  subscription: Subscription;
  user: { plan: PlanId };
  invoice: CryptoInvoice;
}> {
  return request<{
    success: boolean;
    subscription: Subscription;
    user: { plan: PlanId };
    invoice: CryptoInvoice;
  }>(`/billing/crypto/confirm/${invoiceId}`, {
    method: 'POST',
    body: JSON.stringify({ txHash, mode }),
  });
}

// --- Stripe ---

export async function createStripeCheckout(
  planId: PlanId,
): Promise<{ url: string; sessionId?: string; mock?: boolean }> {
  return request<{ url: string; sessionId?: string; mock?: boolean }>(
    '/billing/stripe/create-checkout',
    {
      method: 'POST',
      body: JSON.stringify({ planId }),
    },
  );
}
