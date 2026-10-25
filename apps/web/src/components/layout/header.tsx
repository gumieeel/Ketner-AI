import { useLocation, useNavigate } from 'react-router-dom';
import { MenuIcon, PlusIcon, ShareIcon, SidebarIcon } from '@/components/icons';
import { IconButton } from '@/components/ui/icon-button';
import { StubAction } from '@/components/ui/stub-action';
import { useChat } from '@/features/chat/chat-store';
import { usePreferences } from '@/features/preferences/preferences-store';
import { ModelPicker } from '@/components/chat/model-picker';
import { MaxModeToggle } from '@/components/chat/max-mode-toggle';
import { CompareToggle } from '@/components/chat/compare-toggle';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { Brand } from './brand';
import { HeaderMenu } from './header-menu';
import { ThemeToggle } from './theme-toggle';

/**
 * Шапка рабочей области: логотип, выбор модели, тема и профиль.
 * Список чатов открывается кнопкой слева: на узких экранах шторкой, на широких — панелью.
 */
export function Header() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const toggleSidebar = usePreferences((state) => state.toggleSidebar);
  const sidebarDocked = usePreferences((state) => state.sidebarDocked);
  const toggleSidebarDocked = usePreferences((state) => state.toggleSidebarDocked);
  const activeId = useChat((state) => state.activeId);
  const streaming = useChat((state) => state.streaming);
  const conversations = useChat((state) => state.conversations);
  const openConversation = useChat((state) => state.openConversation);

  const inChat = location.pathname.startsWith('/chat');
  const title = conversations.find((conversation) => conversation.id === activeId)?.title;

  return (
    <header className="sticky top-0 z-[var(--z-header)] flex h-16 shrink-0 items-center gap-2 border-b border-stroke bg-canvas/85 px-3 text-text backdrop-blur-xl md:gap-3 md:px-6">
      <IconButton label={t('nav.openSidebar')} className="md:hidden" onClick={toggleSidebar}>
        <MenuIcon className="size-4" />
      </IconButton>
      <IconButton
        label={sidebarDocked ? t('nav.closeSidebar') : t('nav.openSidebar')}
        aria-pressed={sidebarDocked}
        className={cn('max-md:hidden', sidebarDocked && 'bg-surface-2 text-text')}
        onClick={toggleSidebarDocked}
      >
        <SidebarIcon className="size-[18px]" />
      </IconButton>

      <Brand className="max-md:hidden" />

      {inChat ? (
        <>
          <ModelPicker disabled={streaming} />
          <MaxModeToggle disabled={streaming} />
          <CompareToggle disabled={streaming} />
          <span aria-hidden="true" className="hidden h-5 w-px shrink-0 bg-stroke xl:block" />
        </>
      ) : null}

      {inChat ? null : (
        <span aria-hidden="true" className="hidden h-5 w-px shrink-0 bg-stroke md:block" />
      )}

      <h1
        className={cn(
          'min-w-0 truncate text-sm font-medium',
          inChat ? 'text-muted max-xl:sr-only' : 'text-text',
        )}
      >
        {inChat
          ? title || t('chat.title')
          : location.pathname.startsWith('/code')
            ? t('code.title')
            : location.pathname.startsWith('/images')
              ? t('images.title')
              : t('app.name')}
      </h1>

      <div className={cn('ml-auto flex shrink-0 items-center gap-1.5', inChat && 'max-sm:gap-0.5')}>
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
            <span className="max-sm:hidden">
              <StubAction
                label={t('chat.share')}
                hint={t('chat.composerNotice')}
                placement="bottom"
              >
                <ShareIcon className="size-4" />
              </StubAction>
            </span>
          </>
        ) : null}
        <ThemeToggle className="max-md:hidden" />
        <HeaderMenu variant="avatar" />
      </div>
    </header>
  );
}
