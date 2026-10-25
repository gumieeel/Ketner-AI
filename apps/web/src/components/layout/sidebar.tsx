import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  BookOpenIcon,
  CheckIcon,
  CloseIcon,
  CodeIcon,
  EditIcon,
  ImageIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SparkleIcon,
  TrashIcon,
  UserIcon,
} from '@/components/icons';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
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

const PLAN_TONES: Record<string, BadgeTone> = { plus: 'plus', pro: 'pro', ultra: 'ultra' };

const GROUP_ORDER: readonly DateGroup[] = ['today', 'yesterday', 'week', 'earlier'];

const GROUP_LABELS: Record<DateGroup, TranslationKey> = {
  today: 'chats.groupToday',
  yesterday: 'chats.groupYesterday',
  week: 'chats.groupWeek',
  earlier: 'chats.groupEarlier',
};

const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
  cn(
    'relative flex min-h-10 items-center gap-2.5 rounded-full px-3.5 text-[14px] transition-colors duration-150 max-md:min-h-11',
    isActive
      ? 'bg-surface-3 font-medium text-text [&>svg]:text-accent'
      : 'text-muted hover:bg-surface-2 hover:text-text',
  );

/** Сайдбар рабочей области: список диалогов, поиск, настройки и профиль. */
export function Sidebar() {
  const { t } = useTranslation();
  const user = useAuth((state) => state.user);

  const hasAdminAccess = Boolean(user?.isAdmin);

  const open = usePreferences((state) => state.sidebarOpen);
  const docked = usePreferences((state) => state.sidebarDocked);
  const setOpen = usePreferences((state) => state.setSidebarOpen);
  useEffect(() => {
    if (open && window.innerWidth < 768) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => {
      document.body.style.overflow = '';
    };
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
        : conversations.filter((conversation) => conversation.title.toLowerCase().includes(query));

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
          className="fixed inset-0 z-[var(--z-drawer)] bg-overlay md:hidden"
        />
      ) : null}

      <aside
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        aria-label={t('nav.chats')}
        aria-hidden={!open ? undefined : false}
        className={cn(
          'fixed inset-y-0 left-0 z-[calc(var(--z-drawer)+1)] flex w-[min(360px,85vw)] flex-col md:w-[272px]',
          'border-r border-stroke bg-surface text-text',
          'transition-transform duration-[260ms] ease-out-expo md:static md:z-auto md:translate-x-0',
          open ? 'translate-x-0 shadow-2xl md:shadow-none' : '-translate-x-full',
          // На широких экранах панель либо закреплена, либо скрыта: открывает её кнопка в шапке.
          !docked && 'md:hidden',
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-stroke px-4">
          <Brand className="md:hidden" />
          <span className="hidden text-[15px] font-medium text-text md:block">
            {t('nav.chats')}
          </span>
          <IconButton
            ref={closeButtonRef}
            label={t('nav.closeSidebar')}
            onClick={close}
            className="md:hidden"
          >
            <CloseIcon className="size-4" />
          </IconButton>
        </div>

        <div className="flex shrink-0 flex-col gap-3 p-3">
          <Link
            to="/chat"
            onClick={handleNewChat}
            className={buttonClasses({ variant: 'primary', size: 'md', fullWidth: true })}
          >
            <PlusIcon className="size-4" />
            <span>{t('nav.newChat')}</span>
          </Link>

          <nav aria-label={t('nav.mainNavigation')} className="flex flex-col gap-0.5">
            <NavLink to="/code" onClick={close} className={navLinkClasses}>
              <CodeIcon className="size-4 shrink-0" />
              <span>{t('nav.code')}</span>
            </NavLink>
            <NavLink to="/images" onClick={close} className={navLinkClasses}>
              <ImageIcon className="size-4 shrink-0" />
              <span>{t('nav.images')}</span>
            </NavLink>
          </nav>

          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-subtle" />
            <input
              type="search"
              name="ketner-chat-search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              data-1p-ignore=""
              data-lpignore="true"
              data-form-type="other"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={t('nav.searchChats')}
              placeholder={t('nav.searchChats')}
              className="h-10 w-full rounded-full border border-stroke bg-canvas pr-3 pl-10 text-[14px] text-text outline-none transition-[border-color,box-shadow] placeholder:text-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent-soft max-md:h-11"
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
          {status === 'loading' ? <ConversationsSkeleton /> : null}

          {status === 'error' ? (
            <div className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-center">
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
            <div className="px-3 py-4">
              <p className="text-[13px] font-medium text-text">{t('nav.empty')}</p>
              <p className="mt-1 text-[13px] leading-5 text-muted">{t('nav.emptyHint')}</p>
            </div>
          ) : null}

          {status !== 'loading' &&
          status !== 'error' &&
          conversations.length > 0 &&
          groups.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-muted">{t('chat.searchEmpty')}</p>
          ) : null}

          {groups.map(({ group, items }) => (
            <section key={group} className="flex flex-col gap-0.5">
              <span className="px-3 pt-3.5 pb-1 text-[12px] text-subtle">
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

        <div className="mt-auto flex shrink-0 flex-col gap-0.5 border-t border-stroke p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
              <UserIcon className="size-4 shrink-0" />
              <span className="flex-1">{t('nav.adminPanel')}</span>
            </NavLink>
          ) : null}

          <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-stroke px-1 pt-3">
            {user ? (
              <Link
                to="/settings"
                onClick={close}
                title={user.name}
                className="group/user -mx-1 flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 transition-colors hover:bg-surface-2"
              >
                <span
                  aria-hidden="true"
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-3 text-[12px] font-medium text-text"
                >
                  {user.name ? user.name.slice(0, 2).toUpperCase() : 'U'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-text">
                    {user.name}
                  </span>
                  <span className="block pt-0.5">
                    <Badge
                      tone={PLAN_TONES[user.plan] ?? 'neutral'}
                      className="px-1.5 py-0 text-[11px] capitalize leading-[18px]"
                    >
                      {user.plan}
                    </Badge>
                  </span>
                </span>
              </Link>
            ) : (
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted ring-1 ring-stroke">
                  <UserIcon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-text">{t('nav.guest')}</p>
                  <Link
                    to="/login"
                    onClick={close}
                    className="-my-3 inline-flex min-h-11 items-center text-xs font-medium text-accent hover:underline"
                  >
                    {t('nav.login')}
                  </Link>
                </div>
              </div>
            )}
            <ThemeToggle />
          </div>

          <div className="px-1 pt-2">
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
        className="flex min-h-10 items-center gap-1 px-1 max-md:min-h-11"
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
          className="h-8 min-w-0 flex-1 rounded-lg border border-accent bg-canvas px-2.5 text-[13px] text-text outline-none ring-4 ring-accent-soft max-md:h-10"
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
      <div className="flex min-h-10 items-center gap-1.5 rounded-lg border border-danger/30 bg-danger-soft px-2 text-danger max-md:min-h-11">
        <span className="min-w-0 flex-1 truncate py-2 text-[13px] leading-5">
          {t('chats.deleteConfirm')}
        </span>
        <button
          type="button"
          onClick={() => {
            void remove(conversation.id);
            setConfirming(false);
            if (active) {
              navigate('/chat', { replace: true });
            }
          }}
          className="inline-flex min-h-8 items-center rounded-md px-2.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/15 max-md:min-h-10"
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
        'group relative flex min-h-10 items-center gap-1.5 rounded-xl pr-1 pl-3 text-sm transition-colors max-md:min-h-11',
        active
          ? 'bg-surface-3 font-medium text-text'
          : 'text-muted hover:bg-surface-2 hover:text-text',
      )}
    >
      {active ? (
        <span aria-hidden="true" className="absolute top-2.5 bottom-2.5 left-0 w-[2px] bg-accent" />
      ) : null}

      <NavLink
        to={`/chat/${conversation.id}`}
        onClick={onNavigate}
        title={conversation.title}
        className="min-w-0 flex-1 truncate py-3.5 text-[13px] md:py-2.5"
      >
        {conversation.title === '' ? t('chat.title') : conversation.title}
      </NavLink>

      {isStreaming ? (
        <StatusDot tone="brand" pulse className="mr-1" aria-label={t('chat.thinking')} />
      ) : null}

      {showDate ? (
        <span className="shrink-0 text-[11px] text-subtle md:group-focus-within:hidden md:group-hover:hidden">
          {formatShortDate(conversation.updatedAt, language)}
        </span>
      ) : null}

      <div
        className={cn(
          'flex shrink-0 items-center gap-0.5',
          // На десктопе кнопки появляются поверх названия при наведении или фокусе и не отнимают у него места.
          'md:absolute md:top-1/2 md:right-1 md:-translate-y-1/2 md:rounded-lg md:opacity-0 md:shadow-[-12px_0_10px_-4px_var(--row-bg)] md:transition-opacity',
          'md:group-focus-within:opacity-100 md:group-hover:opacity-100',
          active
            ? 'md:bg-surface-3 md:[--row-bg:var(--surface-3)]'
            : 'md:bg-surface-2 md:[--row-bg:var(--surface-2)]',
        )}
      >
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
        <IconButton label={t('chats.delete')} size="sm" onClick={() => setConfirming(true)}>
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
        <Skeleton key={index} className="h-9 w-full rounded-lg" />
      ))}
    </div>
  );
}
