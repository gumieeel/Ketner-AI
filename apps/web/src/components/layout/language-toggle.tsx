import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { hasEnglishTwin, localizePath } from '@/lib/locale-path';
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
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();

  const choose = (value: Language) => {
    setLanguage(value);
    // На странице с английской версией язык меняет и адрес: /pricing ↔ /en/pricing.
    if (hasEnglishTwin(pathname)) {
      navigate(`${localizePath(pathname, value)}${search}${hash}`, { replace: true });
    }
  };

  return (
    <div
      role="group"
      aria-label={t('settings.language')}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-sm border border-stroke p-0.5',
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
            onClick={() => choose(option.value)}
            className={cn(
              'relative inline-flex min-h-7 min-w-9 items-center justify-center rounded-xs px-2.5 text-[12px] font-medium',
              'transition-[background-color,color] duration-150 max-md:min-h-11 max-md:min-w-11',
              active ? 'bg-surface-3 text-text' : 'text-muted hover:text-text',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
