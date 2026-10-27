import { BoltIcon } from '@/components/icons';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

/**
 * Переключатель режима Max: модели думают дольше (xhigh вместо medium) и отвечают глубже на
 * сложных задачах. Доступен всем; запрос дороже обычного, цену показывает строка кредитов.
 */
export function MaxModeToggle({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const maxMode = usePreferences((state) => state.maxMode);
  const setMaxMode = usePreferences((state) => state.setMaxMode);

  const hint = maxMode ? t('chat.maxModeOn') : t('chat.maxModeOff');

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={maxMode}
      aria-label={`${t('chat.maxMode')}: ${hint}`}
      title={hint}
      onClick={() => setMaxMode(!maxMode)}
      className={cn(
        'inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium max-md:h-11 max-lg:size-10 max-lg:px-0 max-md:max-lg:size-11',
        'transition-[background-color,border-color,color,box-shadow] duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:cursor-not-allowed disabled:opacity-60',
        maxMode
          ? 'border-accent/50 bg-accent-soft text-accent shadow-glow'
          : 'border-stroke text-muted hover:border-stroke-strong hover:bg-surface-2/70 hover:text-text',
      )}
    >
      <BoltIcon className="size-3.5 max-lg:size-4" aria-hidden="true" />
      <span className="max-lg:sr-only">{t('chat.maxMode')}</span>
    </button>
  );
}
