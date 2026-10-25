import type { BadgeTone } from '@/components/ui/badge';
import type { TranslationKey } from '@/i18n';

/** Короткое «для чего» по id модели. Модели без записи в таблицу не попадают в списки на главной. */
export const GOOD_FOR: Record<string, TranslationKey> = {
  'ketner-mini': 'home.good.ketnerMini',
  'ketner-pro': 'home.good.ketnerPro',
  'claude-haiku-5.5': 'home.good.haiku',
  'deepseek-v4.1-flash': 'home.good.deepseek',
  'gpt-5.6-luna-pro': 'home.good.luna',
  'qwen3.8-27b': 'home.good.qwen',
  'gemini-3.7-flash': 'home.good.gemini',
  'glm-5.3': 'home.good.glm',
  'gpt-6.1-sol': 'home.good.sol61',
  'claude-opus-5.5': 'home.good.opus',
  'claude-sonnet-5.5': 'home.good.sonnet',
  'gpt-6-astra': 'home.good.astra',
  'grok-4.7': 'home.good.grok',
  'gpt-5.6-sol': 'home.good.sol56',
  'gpt-5.6-terra': 'home.good.terra',
};

export type Tier = 'free' | 'plus' | 'pro';
export const TIER_LABEL: Record<Tier, string> = { free: 'Free', plus: 'Plus', pro: 'Pro' };
export const TIER_TONE: Record<Tier, BadgeTone> = { free: 'neutral', plus: 'plus', pro: 'pro' };

export function tierOf(requiredPlan: string | undefined): Tier {
  if (requiredPlan === 'plus') return 'plus';
  if (requiredPlan === 'pro' || requiredPlan === 'ultra') return 'pro';
  return 'free';
}
