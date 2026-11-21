/**
 * Уровень доступа. `credits` — у тех, кто купил пакет кредитов и ещё не израсходовал его:
 * вычисляется сервером, в профиле не хранится. `plus`, `pro`, `ultra` остались у подписчиков
 * прежней системы до конца оплаченного периода.
 */
export type PlanId =
  'free' | 'credits' | 'gpt-pro' | 'claude-pro' | 'gemini-pro' | 'ultra' | 'plus' | 'pro';

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled';

export interface Subscription {
  userId: string;
  plan: PlanId;
  status: SubscriptionStatus;
  renewsAt: string | null;
}
