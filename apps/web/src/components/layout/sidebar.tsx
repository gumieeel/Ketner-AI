import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  BookOpenIcon,
  CheckIcon,
  CloseIcon,
  EditIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SparkleIcon,
  TrashIcon,
  UserIcon,
} from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CornerMark } from '@/components/ui/corner-mark';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusDot } from '@/components/ui/status-dot';
import { useAuth } from '@/features/auth/auth-store';
import { useChat } from '@/features/chat/chat-store';
import type { ConversationSummary } from '@/features/chat/types';
import { usePreferences } from '@/features/preferences/preferences-store';
import { cn } from '@/lib/cn';
import { dateGroupOf, formatShortDate, type DateGroup } from '@/lib/format-date';
import { useTranslation } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import { Brand } from './brand';
import { LanguageToggle } from './language-toggle';
import { ThemeToggle } from './theme-toggle';

const GROUP_ORDER: readonly DateGroup[] = ['today', 'yesterday', 'week', 'earlier'];

const GROUP_LABELS: Record<DateGroup, TranslationKey> = {
  today: 'chats.groupToday',
  yesterday: 'chats.groupYesterday',
  week: 'chats.groupWeek',
  earlier: 'chats.groupEarlier',
};

const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex min-h-[44px] py-4 items-center gap-2.5 rounded-md px-3 text-sm transition-colors',
    isActive
      ? 'bg-surface-2 font-medium text-text border-l-[3px] border-accent pl-[calc(0.75rem-3px)]'
      : 'text-muted hover:bg-surface-2 hover:text-text',
  );

/** Сайдбар рабочей области: список диалогов, поиск, настройки и профиль. */
export function Sidebar() {
  const { t } = useTranslation();
  const user = useAuth((state) => state.user);

  const hasAdminAccess = Boolean(
    user && (
      user.isAdmin ||
      user.email?.toLowerCase() === 'artemsinyakov09@gmail.com' ||
      user.email?.toLowerCase().startsWith('admin@') ||
      user.email?.toLowerCase().startsWith('admin.')
    )
  );

  const open = usePreferences((state) => state.sidebarOpen);
  const setOpen = usePreferences((state) => state.setSidebarOpen);
  useEffect(() => {
    if (open && window.innerWidth < 768) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  const conversations = useChat((state) => state.conversations);
  const status = useChat((state) => state.conversationsStatus);
  const activeId = useChat((state) => state.activeId);
  const search = useChat((state) => state.search);
  const setSearch = useChat((state) => state.setSearch);
  const loadConversations = useChat((state) => state.loadConversations);
  const openConversation = useChat((state) => state.openConversation);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const close = () => setOpen(false);

  const handleNewChat = () => {
    void openConversation(undefined);
    close();
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    // Фокус на кнопку закрытия при открытии мобильной шторки
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen]);

  const groups = useMemo(() => {
    const query = search.trim().toLowerCase();
    const visible =
      query === ''
        ? conversations
        : conversations.filter((conversation) =>
            conversation.title.toLowerCase().includes(query),
          );

    return GROUP_ORDER.map((group) => ({
      group,
      items: visible.filter((conversation) => dateGroupOf(conversation.updatedAt) === group),
    })).filter((section) => section.items.length > 0);
  }, [conversations, search]);

  const [startX, setStartX] = useState(0);
  const handleTouchStart = (e: React.TouchEvent) => setStartX(e.touches[0].clientX);
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (startX - e.changedTouches[0].clientX > 50) close();
  };

  return (
    <>
      {open ? (
        <div
          aria-hidden="true"
          onClick={close}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-[1px] md:hidden"
        />
      ) : null}

      <aside
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        aria-label={t('nav.chats')}
        aria-hidden={!open ? undefined : false}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[min(360px,85vw)] md:w-[264px] flex-col',
          'border-r border-stroke bg-surface text-text',
          'transition-transform duration-[180ms] ease-out md:static md:z-auto md:translate-x-0',
          open ? 'translate-x-0 shadow-xl md:shadow-none' : '-translate-x-full',
        )}
      >
        <div className="flex h-12 items-center justify-between px-3 border-b border-stroke">
          <Brand />
          <IconButton
            ref={closeButtonRef}
            label={t('nav.closeSidebar')}
            onClick={close}
            className="md:hidden"
          >
            <CloseIcon className="size-4" />
          </IconButton>
        </div>

        <div className="flex flex-col gap-2.5 p-3">
          <Link
            to="/chat"
            onClick={handleNewChat}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-stroke bg-surface-2 px-3 text-sm font-medium text-text transition-colors hover:border-stroke-strong hover:bg-surface-3"
          >
            <PlusIcon className="size-4" />
            <span>{t('nav.newChat')}</span>
          </Link>

          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 size-4 text-muted" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={t('nav.searchChats')}
              placeholder={t('nav.searchChats')}
              className="h-9 w-full rounded-md border border-stroke bg-canvas pr-3 pl-8 text-sm text-text placeholder:text-muted focus:border-stroke-strong outline-none transition-colors"
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
          {status === 'loading' ? <ConversationsSkeleton /> : null}

          {status === 'error' ? (
            <div className="rounded-md border border-danger/30 bg-danger-soft p-3 text-center">
              <p className="text-xs text-danger">{t('chats.loadError')}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void loadConversations()}
              >
                {t('common.retry')}
              </Button>
            </div>
          ) : null}

          {status !== 'loading' && status !== 'error' && conversations.length === 0 ? (
            <div className="rounded-md border border-dashed border-stroke p-4 text-center my-auto">
              <SparkleIcon className="mx-auto mb-2 size-5 text-subtle" />
              <p className="text-xs font-medium text-text">{t('nav.empty')}</p>
              <p className="mt-1 text-[11px] text-muted">{t('nav.emptyHint')}</p>
            </div>
          ) : null}

          {status !== 'loading' &&
          status !== 'error' &&
          conversations.length > 0 &&
          groups.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted text-center">{t('chat.searchEmpty')}</p>
          ) : null}

          {groups.map(({ group, items }) => (
            <section key={group} className="flex flex-col gap-0.5">
              <span className="px-2 pt-3 pb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-subtle font-semibold">
                {t(GROUP_LABELS[group])}
              </span>
              {items.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === activeId}
                  showDate={group === 'earlier'}
                  onNavigate={close}
                />
              ))}
            </section>
          ))}
        </div>

        <div className="mt-auto flex flex-col gap-1 border-t border-stroke p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <NavLink to="/docs" onClick={close} className={navLinkClasses}>
            <BookOpenIcon className="size-4 shrink-0" />
            <span>{t('nav.docs')}</span>
          </NavLink>
          <NavLink to="/pricing" onClick={close} className={navLinkClasses}>
            <SparkleIcon className="size-4 shrink-0" />
            <span>{t('nav.upgrade')}</span>
          </NavLink>
          <NavLink to="/settings" onClick={close} className={navLinkClasses}>
            <SettingsIcon className="size-4 shrink-0" />
            <span>{t('nav.settings')}</span>
          </NavLink>
          {hasAdminAccess ? (
            <NavLink to="/admin" onClick={close} className={navLinkClasses}>
              <UserIcon className="size-4 shrink-0 text-accent" />
              <span className="flex-1 font-semibold text-accent">Admin Panel</span>
              <Badge tone="brand">ADMIN</Badge>
            </NavLink>
          ) : null}

          <div className="flex items-center justify-between gap-2 pt-2 mt-1 border-t border-stroke px-1">
            {user ? (
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Link
                  to="/settings"
                  onClick={close}
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent text-xs font-semibold hover:opacity-85 transition-opacity"
                  title={user.name}
                >
                  {user.name ? user.name.slice(0, 2).toUpperCase() : 'U'}
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    to="/settings"
                    onClick={close}
                    className="block truncate text-xs font-medium text-text hover:underline"
                  >
                    {user.name}
                  </Link>
                  <div className="pt-0.5">
                    <Badge tone="brand" className="font-mono text-[9px] px-1 py-0 uppercase">
                      {user.plan}
                    </Badge>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
                  <UserIcon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-text">{t('nav.guest')}</p>
                  <Link
                    to="/login"
                    onClick={close}
                    className="text-xs text-accent hover:underline font-mono"
                  >
                    {t('nav.login')}
                  </Link>
                </div>
              </div>
            )}
            <ThemeToggle />
          </div>

          <div className="pt-1 px-1">
            <LanguageToggle className="w-full justify-center" />
          </div>
        </div>
      </aside>
    </>
  );
}

/** Строка диалога: открытие, переименование и удаление с подтверждением. */
function ConversationRow({
  conversation,
  active,
  showDate,
  onNavigate,
}: {
  conversation: ConversationSummary;
  active: boolean;
  showDate: boolean;
  onNavigate: () => void;
}) {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const rename = useChat((state) => state.rename);
  const remove = useChat((state) => state.remove);
  const isStreaming = useChat((state) => !!state.streamingConversations[conversation.id]);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(conversation.title);
  const [confirming, setConfirming] = useState(false);

  if (editing) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void rename(conversation.id, value);
          setEditing(false);
        }}
        className="flex h-9 items-center gap-1 px-1"
      >
        <label htmlFor={`rename-${conversation.id}`} className="sr-only">
          {t('chats.rename')}
        </label>
        <input
          id={`rename-${conversation.id}`}
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setEditing(false);
            }
          }}
          className="h-7 min-w-0 flex-1 rounded-sm border border-accent bg-canvas px-2 text-xs text-text outline-none"
        />
        <IconButton label={t('common.save')} size="sm" type="submit">
          <CheckIcon className="size-3.5" />
        </IconButton>
        <IconButton label={t('common.cancel')} size="sm" onClick={() => setEditing(false)}>
          <CloseIcon className="size-3.5" />
        </IconButton>
      </form>
    );
  }

  if (confirming) {
    return (
      <div className="flex h-9 items-center gap-1.5 rounded-md border border-danger/30 bg-danger-soft px-2 text-danger">
        <span className="min-w-0 flex-1 truncate text-xs">{t('chats.deleteConfirm')}</span>
        <button
          type="button"
          onClick={() => {
            void remove(conversation.id);
            setConfirming(false);
            if (active) {
              navigate('/chat', { replace: true });
            }
          }}
          className="rounded-sm px-2 py-0.5 text-xs font-medium text-danger hover:bg-danger/20 transition-colors"
        >
          {t('chats.deleteYes')}
        </button>
        <IconButton label={t('common.cancel')} size="sm" onClick={() => setConfirming(false)}>
          <CloseIcon className="size-3.5 text-danger" />
        </IconButton>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group relative flex h-9 items-center gap-1.5 rounded-md px-2 text-sm transition-colors',
        active
          ? 'bg-surface-3 text-text font-medium'
          : 'text-muted hover:bg-surface-2 hover:text-text',
      )}
    >
      {active ? (
        <CornerMark size={10} className="shrink-0 text-accent mr-0.5" />
      ) : null}

      <NavLink
        to={`/chat/${conversation.id}`}
        onClick={onNavigate}
        title={conversation.title}
        className="min-w-0 flex-1 truncate text-xs"
      >
        {conversation.title === '' ? t('chat.title') : conversation.title}
      </NavLink>

      {isStreaming ? (
        <StatusDot
          tone="brand"
          pulse
          className="mr-1"
          aria-label={t('chat.thinking')}
        />
      ) : null}

      {showDate ? (
        <span className="shrink-0 font-mono text-[10px] text-muted md:group-hover:hidden">
          {formatShortDate(conversation.updatedAt, language)}
        </span>
      ) : null}

      <div className="flex shrink-0 items-center gap-0.5 md:opacity-0 md:transition-opacity md:group-focus-within:opacity-100 md:group-hover:opacity-100">
        <IconButton
          label={t('chats.rename')}
          size="sm"
          onClick={() => {
            setValue(conversation.title);
            setEditing(true);
          }}
        >
          <EditIcon className="size-3.5" />
        </IconButton>
        <IconButton
          label={t('chats.delete')}
          size="sm"
          onClick={() => setConfirming(true)}
        >
          <TrashIcon className="size-3.5" />
        </IconButton>
      </div>
    </div>
  );
}

function ConversationsSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-1">
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} className="h-7 w-full" />
      ))}
    </div>
  );
}
