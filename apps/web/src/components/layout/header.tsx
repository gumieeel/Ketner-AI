import { useLocation, useNavigate } from 'react-router-dom';
import { MenuIcon, PlusIcon, ShareIcon } from '@/components/icons';
import { IconButton } from '@/components/ui/icon-button';
import { StubAction } from '@/components/ui/stub-action';
import { useChat } from '@/features/chat/chat-store';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useTranslation } from '@/i18n';
import { LanguageToggle } from './language-toggle';
import { ThemeToggle } from './theme-toggle';

/** Шапка рабочей области: название диалога, «Поделиться», язык и тема. */
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
    <header className="sticky top-0 z-30 flex h-[56px] shrink-0 items-center gap-2 border-b border-stroke bg-canvas/80 backdrop-blur-md px-4 text-text">
      <IconButton label={t('nav.openSidebar')} className="md:hidden" onClick={toggleSidebar}>
        <MenuIcon className="size-4" />
      </IconButton>

      <h1 className="truncate text-sm font-medium text-text">
        {inChat ? title || t('chat.title') : t('app.name')}
      </h1>

      <div className="ml-auto flex items-center gap-1.5">
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
              <PlusIcon className="size-4" />
            </IconButton>
            <StubAction label={t('chat.share')} hint={t('chat.composerNotice')}>
              <ShareIcon className="size-4" />
            </StubAction>
          </>
        ) : null}
        <LanguageToggle />
        <ThemeToggle />
      </div>
    </header>
  );
}
