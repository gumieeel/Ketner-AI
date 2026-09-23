import { cn } from '@/lib/cn';
import { usePreferences, type Language } from '@/features/preferences/preferences-store';
import { useTranslation } from '@/i18n';

const OPTIONS: { value: Language; label: string }[] = [
  { value: 'ru', label: 'RU' },
  { value: 'en', label: 'EN' },
];

export function LanguageToggle({ className }: { className?: string }) {
  const language = usePreferences((state) => state.language);
  const setLanguage = usePreferences((state) => state.setLanguage);
  const { t } = useTranslation();

  return (
    <div
      role="group"
      aria-label={t('settings.language')}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-[6px] border border-stroke/20 bg-canvas p-0.5',
        className,
      )}
    >
      {OPTIONS.map((option) => {
        const active = option.value === language;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => setLanguage(option.value)}
            className={cn(
              'rounded-[4px] px-2.5 py-1 text-xs font-medium transition-colors',
              active ? 'bg-surface text-text' : 'text-muted hover:text-text',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
