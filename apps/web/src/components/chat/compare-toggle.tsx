import { CompareIcon } from '@/components/icons';
import { useAuth } from '@/features/auth/auth-store';
import { useChat } from '@/features/chat/chat-store';
import { defaultCompareModelIds, sanitizeCompareModelIds } from '@/features/chat/compare-policy';
import { useCompare } from '@/features/chat/compare-store';
import { DEFAULT_MODELS } from '@/features/chat/model-catalog';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

/**
 * Переключатель режима сравнения. Включённый, он отправляет следующий вопрос нескольким моделям
 * сразу. Открыт всем: до первой покупки кредитов сравниваются две модели, после неё — до четырёх.
 */
export function CompareToggle({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const user = useAuth((state) => state.user);
  const meta = useChat((state) => state.meta);
  const enabled = useCompare((state) => state.enabled);
  const setEnabled = useCompare((state) => state.setEnabled);
  const setModelIds = useCompare((state) => state.setModelIds);

  const on = enabled;
  const hint = on ? t('compare.toggleOn') : t('compare.toggleOff');

  const toggle = (): void => {
    if (!enabled) {
      // Первое включение (или выбранных моделей больше нет в каталоге): предлагаем разумный набор.
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
      aria-pressed={on}
      aria-label={`${t('compare.toggle')}: ${hint}`}
      title={hint}
      onClick={toggle}
      className={cn(
        'inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium max-md:h-11 max-lg:size-10 max-lg:px-0 max-md:max-lg:size-11',
        'transition-[background-color,border-color,color,box-shadow] duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:cursor-not-allowed disabled:opacity-60',
        on
          ? 'border-accent/50 bg-accent-soft text-accent shadow-glow'
          : 'border-stroke text-muted hover:border-stroke-strong hover:bg-surface-2/70 hover:text-text',
      )}
    >
      <CompareIcon className="size-3.5 max-lg:size-4" aria-hidden="true" />
      <span className="max-lg:sr-only">{t('compare.toggle')}</span>
    </button>
  );
}
