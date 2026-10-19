import { CompareIcon, LockIcon } from '@/components/icons';
import { useAuth } from '@/features/auth/auth-store';
import { useUpgradeModal } from '@/features/billing/upgrade-modal-store';
import { useChat } from '@/features/chat/chat-store';
import {
  defaultCompareModelIds,
  maxCompareModels,
  sanitizeCompareModelIds,
} from '@/features/chat/compare-policy';
import { useCompare } from '@/features/chat/compare-store';
import { DEFAULT_MODELS } from '@/features/chat/can-access-model';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

/**
 * Переключатель режима сравнения. Включённый, он отправляет следующий вопрос нескольким моделям
 * сразу. На Free и у гостей кнопка видна с замком и открывает окно перехода на Plus.
 */
export function CompareToggle({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const user = useAuth((state) => state.user);
  const meta = useChat((state) => state.meta);
  const enabled = useCompare((state) => state.enabled);
  const setEnabled = useCompare((state) => state.setEnabled);
  const setModelIds = useCompare((state) => state.setModelIds);
  const openUpgrade = useUpgradeModal((state) => state.open);

  const allowed = maxCompareModels(user?.plan) > 0;
  const on = allowed && enabled;
  const hint = !allowed ? t('compare.locked') : on ? t('compare.toggleOn') : t('compare.toggleOff');

  const toggle = (): void => {
    if (!allowed) {
      openUpgrade({ reason: 'compare', requiredPlan: 'PLUS' });
      return;
    }
    if (!enabled) {
      // Первое включение (или выбранные модели стали недоступны): предлагаем разумный набор.
      const models = meta && meta.models.length > 0 ? meta.models : DEFAULT_MODELS;
      const current = sanitizeCompareModelIds(useCompare.getState().modelIds, models, user?.plan);
      if (current.length < 2) {
        setModelIds(defaultCompareModelIds(models, user?.plan));
      }
    }
    setEnabled(!enabled);
  };

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={allowed ? on : undefined}
      aria-label={`${t('compare.toggle')}: ${hint}`}
      title={hint}
      onClick={toggle}
      className={cn(
        'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-semibold max-md:h-11',
        'transition-[background-color,border-color,color,box-shadow] duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:cursor-not-allowed disabled:opacity-60',
        on
          ? 'border-accent/50 bg-accent-soft text-accent shadow-glow'
          : 'border-stroke bg-surface-2/70 text-muted hover:border-stroke-strong hover:bg-surface-2 hover:text-text',
      )}
    >
      {allowed ? (
        <CompareIcon className="size-3.5" aria-hidden="true" />
      ) : (
        <LockIcon className="size-3.5" aria-hidden="true" />
      )}
      <span className="max-sm:sr-only">{t('compare.toggle')}</span>
    </button>
  );
}
