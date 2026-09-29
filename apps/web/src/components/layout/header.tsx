import { useLocation, useNavigate } from 'react-router-dom';
import { MenuIcon, PlusIcon, ShareIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { IconButton } from '@/components/ui/icon-button';
import { StubAction } from '@/components/ui/stub-action';
import { useChat } from '@/features/chat/chat-store';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useTranslation } from '@/i18n';
import { LanguageToggle } from './language-toggle';
import { ThemeToggle } from './theme-toggle';

/** Шапка рабочей области: название диалога, демо-пометка, «Поделиться», язык и тема. */
export function Header() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const toggleSidebar = usePreferences((state) => state.toggleSidebar);
  const activeId = useChat((state) => state.activeId);
  const conversations = useChat((state) => state.conversations);
  const openConversation = useChat((state) => state.openConversation);

  const inChat = location.pathname.startsWith('/chat');
  const title = conversations.find((conversation) => conversation.id === activeId)?.title;

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-stroke bg-canvas px-3 text-text">
      <IconButton label={t('nav.openSidebar')} className="md:hidden" onClick={toggleSidebar}>
        <MenuIcon />
      </IconButton>

      <h1 className="truncate text-sm font-medium text-text">
        {inChat ? title || t('chat.title') : t('app.name')}
      </h1>
      <Badge tone="outline" className="hidden sm:inline-flex">
        {t('common.mock')}
      </Badge>

      <div className="ml-auto flex items-center gap-1">
        {inChat ? (
          <>
            <IconButton
              label={t('nav.newChat')}
              className="md:hidden"
              onClick={() => {
                void openConversation(undefined);
                navigate('/chat');
              }}
            >
              <PlusIcon />
            </IconButton>
            <StubAction label={t('chat.share')} hint={t('chat.composerNotice')}>
              <ShareIcon />
            </StubAction>
          </>
        ) : null}
        <LanguageToggle />
        <ThemeToggle />
      </div>
    </header>
  );
}
