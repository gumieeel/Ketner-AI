import type { Language } from '../preferences/preferences-store';
import type { TranslationKey } from '@/i18n';

export type PlanId = 'free' | 'plus' | 'pro';

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
  bullets: Record<Language, readonly string[]>;
}
