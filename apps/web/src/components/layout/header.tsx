import { MenuIcon, ShareIcon } from '@/components/icons';
import { IconButton } from '@/components/ui/icon-button';
import { StubAction } from '@/components/ui/stub-action';
import { Badge } from '@/components/ui/badge';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useTranslation } from '@/i18n';
import { ThemeToggle } from './theme-toggle';

/**
 * Шапка рабочей области. Заголовок берётся из текущего диалога —
 * пока диалогов нет, показываем название нового чата.
 */
export function Header() {
  const { t } = useTranslation();
  const toggleSidebar = usePreferences((state) => state.toggleSidebar);

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200 px-2 dark:border-zinc-700">
      <IconButton label={t('nav.openSidebar')} className="md:hidden" onClick={toggleSidebar}>
        <MenuIcon />
      </IconButton>

      <h1 className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
        {t('chat.title')}
      </h1>
      <Badge tone="outline" className="hidden sm:inline-flex">
        {t('common.mock')}
      </Badge>

      <div className="ml-auto flex items-center gap-1">
        <StubAction label={t('chat.share')} hint={t('chat.composerNotice')}>
          <ShareIcon />
        </StubAction>
        <ThemeToggle />
      </div>
    </header>
  );
}
