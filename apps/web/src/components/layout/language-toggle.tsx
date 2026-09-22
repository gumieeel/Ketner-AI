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
        'inline-flex items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-700',
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
              'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
              active
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-50'
                : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
