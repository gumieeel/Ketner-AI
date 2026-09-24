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
  popular?: boolean;
  limitBadge?: Record<Language, string>;
  modelsHighlight?: string;
  bullets: Record<Language, readonly string[]>;
}

export type PaymentMethod = 'card' | 'sbp' | 'stars';

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
