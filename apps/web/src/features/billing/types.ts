import type { Language } from '../preferences/preferences-store';
import type { TranslationKey } from '@/i18n';

export type PlanId = 'free' | 'gpt-pro' | 'claude-pro' | 'gemini-pro' | 'ultra' | 'plus' | 'pro';

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled';

export interface Subscription {
  userId: string;
  plan: PlanId;
  status: SubscriptionStatus;
  renewsAt: string | null;
}

export interface Plan {
  id: PlanId;
  nameKey: TranslationKey;
  priceMonthly: number;
  originalPriceMonthly?: number;
  discountBadge?: Record<Language, string>;
  popular?: boolean;
  limitBadge?: Record<Language, string>;
  modelsHighlight?: Record<Language, string> | string;
  bullets: Record<Language, readonly string[]>;
  highlights?: Record<Language, readonly string[]>;
}

export type PaymentMethod = 'sbp' | 'crypto' | 'stars' | 'card';

export type CryptoCurrency = 'USDT_TRC20' | 'USDT_TON' | 'TON' | 'BTC';

export interface CryptoInvoice {
  id: string;
  planId: PlanId;
  currency: CryptoCurrency;
  amount: number;
  amountUsd: number;
  address: string;
  qrPayload: string;
  status: 'pending' | 'confirming' | 'paid' | 'expired';
  expiresAt: string;
  network: string;
  cryptoCloudUrl?: string;
  cryptoCloudInvoiceId?: string;
}

export interface SbpInvoice {
  id: string;
  planId: PlanId;
  amount: number;
  currency: 'RUB';
  status: 'pending' | 'paid' | 'expired';
  qrPayload: string;
  deepLink: string;
  expiresAt: string;
}

export interface TelegramStarsInvoice {
  id: string;
  planId: PlanId;
  priceRub: number;
  starsAmount: number;
  botUsername: string;
  botDeepLink: string;
  status: 'pending' | 'paid';
  expiresAt: string;
}
