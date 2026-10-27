import type { BadgeTone } from '@/components/ui/badge';
import type { TranslationKey } from '@/i18n';

type Translate = (key: TranslationKey) => string;

const LEGACY_TONES: Record<string, BadgeTone> = { plus: 'plus', pro: 'pro', ultra: 'ultra' };

/** Названия прежних подписок: сами тарифы больше не продаются, но у подписчиков они ещё действуют. */
const LEGACY_NAMES: Record<string, string> = {
  plus: 'Plus',
  pro: 'Pro',
  ultra: 'Ultra',
  'gpt-pro': 'GPT Pro',
  'claude-pro': 'Claude Pro',
  'gemini-pro': 'Gemini Pro',
};

export function legacyPlanName(plan: string): string {
  return LEGACY_NAMES[plan] ?? plan.charAt(0).toUpperCase() + plan.slice(1);
}

/**
 * Подпись и цвет уровня доступа для значков в сайдбаре и настройках. `free` и `credits` — два
 * состояния без подписки (пока купленных кредитов нет и когда они есть); остальные названия —
 * прежние подписки, которые доживают оплаченный срок, поэтому остаются как есть.
 */
export function planBadge(plan: string, t: Translate): { label: string; tone: BadgeTone } {
  if (plan === 'free') return { label: t('pricing.free'), tone: 'neutral' };
  if (plan === 'credits') return { label: t('settings.planCredits'), tone: 'brand' };
  return { label: legacyPlanName(plan), tone: LEGACY_TONES[plan] ?? 'brand' };
}
