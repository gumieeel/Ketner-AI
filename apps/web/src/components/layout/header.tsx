import { useLocation } from 'react-router-dom';
import { MenuIcon, ShareIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { IconButton } from '@/components/ui/icon-button';
import { StubAction } from '@/components/ui/stub-action';
import { useChat } from '@/features/chat/chat-store';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useTranslation } from '@/i18n';
import { ThemeToggle } from './theme-toggle';

/** Шапка рабочей области: название диалога, демо-пометка, «Поделиться» и тема. */
export function Header() {
  const { t } = useTranslation();
  const location = useLocation();
  const toggleSidebar = usePreferences((state) => state.toggleSidebar);
  const activeId = useChat((state) => state.activeId);
  const conversations = useChat((state) => state.conversations);

  const inChat = location.pathname.startsWith('/chat');
  const title = conversations.find((conversation) => conversation.id === activeId)?.title;

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200 px-2 dark:border-zinc-700">
      <IconButton label={t('nav.openSidebar')} className="md:hidden" onClick={toggleSidebar}>
        <MenuIcon />
      </IconButton>

      <h1 className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
        {inChat ? title || t('chat.title') : t('app.name')}
      </h1>
      <Badge tone="outline" className="hidden sm:inline-flex">
        {t('common.mock')}
      </Badge>

      <div className="ml-auto flex items-center gap-1">
        {inChat ? (
          <StubAction label={t('chat.share')} hint={t('chat.composerNotice')}>
            <ShareIcon />
          </StubAction>
        ) : null}
        <ThemeToggle />
      </div>
    </header>
  );
}
