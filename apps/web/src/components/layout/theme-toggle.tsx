import { MoonIcon, SunIcon } from '@/components/icons';
import { IconButton } from '@/components/ui/icon-button';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useTranslation } from '@/i18n';

export function ThemeToggle() {
  const theme = usePreferences((state) => state.theme);
  const toggleTheme = usePreferences((state) => state.toggleTheme);
  const { t } = useTranslation();

  const nextThemeLabel = theme === 'dark' ? t('settings.themeLight') : t('settings.themeDark');

  return (
    <IconButton label={`${t('settings.theme')}: ${nextThemeLabel}`} onClick={toggleTheme}>
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </IconButton>
  );
}
