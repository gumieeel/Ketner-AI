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
import { Button } from '@/components/ui/button';
import { CornerMark } from '@/components/ui/corner-mark';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
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
    'flex min-h-[44px] md:min-h-[36px] items-center gap-2 rounded-[6px] px-3 py-2 text-sm leading-5 transition-colors',
    isActive
      ? 'bg-accent/10 font-medium text-text'
      : 'text-muted hover:bg-surface/80 hover:text-text',
  );

/** Сайдбар рабочей области: список диалогов, поиск, настройки и профиль. */
export function Sidebar() {
  const { t } = useTranslation();
  const user = useAuth((state) => state.user);
  const open = usePreferences((state) => state.sidebarOpen);
  const setOpen = usePreferences((state) => state.setSidebarOpen);
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

  return (
    <>
      {open ? (
        <div
          aria-hidden="true"
          onClick={close}
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px] md:hidden"
        />
      ) : null}

      <aside
        aria-label={t('nav.chats')}
        aria-hidden={!open ? undefined : false}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[min(288px,calc(100vw-48px))] md:w-[264px] flex-col',
          'border-r border-stroke/20 bg-surface text-text',
          'transition-transform duration-[180ms] ease-out md:static md:z-auto md:translate-x-0',
          open ? 'translate-x-0 shadow-lg md:shadow-none' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center gap-2 px-3">
          <Brand />
          <button
            ref={closeButtonRef}
            type="button"
            aria-label={t('nav.closeSidebar')}
            title={t('nav.closeSidebar')}
            onClick={close}
            className="ml-auto inline-flex size-9 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 md:size-8 items-center justify-center rounded-[6px] text-muted hover:bg-canvas hover:text-text md:hidden"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="flex flex-col gap-3 px-3">
          <Link
            to="/chat"
            onClick={handleNewChat}
            className={cn(
              'inline-flex min-h-[44px] md:min-h-[40px] items-center gap-2 rounded-[10px] px-3 text-sm leading-5 font-medium transition-colors',
              'border border-stroke/40 text-text hover:bg-canvas',
            )}
          >
            <PlusIcon className="text-lg" />
            {t('nav.newChat')}
          </Link>

          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base text-muted" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={t('nav.searchChats')}
              placeholder={t('nav.searchChats')}
              className={cn(
                'h-10 md:h-9 w-full rounded-[10px] border border-stroke/30 bg-canvas pr-3 pl-9 text-sm leading-5 text-text',
                'placeholder:text-muted focus:border-accent outline-none transition-colors',
              )}
            />
          </div>
        </div>

        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-2">
          <p className="px-3 py-1 text-xs font-medium text-muted">{t('nav.chats')}</p>

          {status === 'loading' ? <ConversationsSkeleton /> : null}

          {status === 'error' ? (
            <div className="rounded-[10px] border border-red-500/30 px-3 py-4 text-center">
              <p className="text-sm text-red-600 dark:text-red-400">{t('chats.loadError')}</p>
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
            <div className="rounded-[10px] border border-dashed border-stroke/30 px-3 py-6 text-center">
              <SparkleIcon className="mx-auto mb-2 text-xl text-muted" />
              <p className="text-sm text-muted">{t('nav.empty')}</p>
              <p className="mt-1 text-xs text-muted/80">{t('nav.emptyHint')}</p>
            </div>
          ) : null}

          {status !== 'loading' &&
          status !== 'error' &&
          conversations.length > 0 &&
          groups.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted">{t('chat.searchEmpty')}</p>
          ) : null}

          {groups.map(({ group, items }) => (
            <section key={group} className="flex flex-col gap-1">
              <p className="px-3 pt-3 pb-1 text-xs font-medium text-muted">
                {t(GROUP_LABELS[group])}
              </p>
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

        <div className="mt-auto flex flex-col gap-2 border-t border-stroke/15 p-3">
          <NavLink to="/settings" onClick={close} className={navLinkClasses}>
            <SettingsIcon className="text-lg" />
            {t('nav.settings')}
          </NavLink>
          <NavLink to="/pricing" onClick={close} className={navLinkClasses}>
            <SparkleIcon className="text-lg" />
            {t('nav.upgrade')}
          </NavLink>
          <NavLink to="/docs" onClick={close} className={navLinkClasses}>
            <BookOpenIcon className="text-lg" />
            {t('nav.docs')}
          </NavLink>

          <div className="flex items-center gap-2 pt-1">
            {user ? (
              <>
                <Link
                  to="/settings"
                  onClick={close}
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/20 text-xs font-semibold text-accent hover:opacity-80"
                  title={user.name}
                >
                  {user.name.slice(0, 2).toUpperCase()}
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    to="/settings"
                    onClick={close}
                    className="block truncate text-sm font-medium text-text hover:underline"
                  >
                    {user.name}
                  </Link>
                  <p className="truncate text-xs text-muted">
                    {user.plan === 'ultra'
                      ? 'Ultra'
                      : user.plan === 'gpt-pro'
                        ? 'GPT Pro'
                        : user.plan === 'claude-pro'
                          ? 'Claude Pro'
                          : user.plan === 'gemini-pro'
                            ? 'Gemini Pro'
                            : user.plan === 'free'
                              ? t('pricing.free')
                              : user.plan.toUpperCase()}
                  </p>
                </div>
              </>
            ) : (
              <>
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-stroke/20 text-muted">
                  <UserIcon className="text-lg" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text">{t('nav.guest')}</p>
                  <Link to="/login" onClick={close} className="text-xs text-accent hover:underline">
                    {t('nav.login')}
                  </Link>
                </div>
              </>
            )}
            <ThemeToggle />
          </div>

          <LanguageToggle className="self-start" />
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
        className="flex min-h-[44px] md:min-h-[36px] items-center gap-1 px-1"
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
          className="h-8 min-w-0 flex-1 rounded-[6px] border border-accent bg-canvas px-2 text-sm text-text outline-none"
        />
        <IconButton label={t('common.save')} size="sm" type="submit">
          <CheckIcon />
        </IconButton>
        <IconButton label={t('common.cancel')} size="sm" onClick={() => setEditing(false)}>
          <CloseIcon />
        </IconButton>
      </form>
    );
  }

  if (confirming) {
    return (
      <div className="flex min-h-[44px] md:min-h-[36px] items-center gap-1 rounded-[6px] bg-red-500/10 px-2 py-1 text-red-600 dark:text-red-300">
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
          className="rounded-[6px] px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-500/20 dark:text-red-300"
        >
          {t('chats.deleteYes')}
        </button>
        <IconButton label={t('common.cancel')} size="sm" onClick={() => setConfirming(false)}>
          <CloseIcon />
        </IconButton>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group flex min-h-[44px] md:min-h-[36px] items-center gap-1 rounded-[6px] pr-1 transition-colors',
        active ? 'bg-accent/10 text-text' : 'hover:bg-canvas text-muted hover:text-text',
      )}
    >
      {active ? <CornerMark size={11} className="shrink-0 ml-2.5 text-accent" /> : null}

      <NavLink
        to={`/chat/${conversation.id}`}
        onClick={onNavigate}
        title={conversation.title}
        className={cn(
          'min-w-0 flex-1 truncate rounded-[6px] px-2.5 py-1.5 text-sm leading-5',
          active ? 'font-medium text-text' : 'text-text/80 hover:text-text',
        )}
      >
        {conversation.title === '' ? t('chat.title') : conversation.title}
      </NavLink>

      {isStreaming ? (
        <span
          className="size-2 shrink-0 rounded-full bg-accent animate-pulse mr-1"
          title={t('chat.thinking')}
          aria-label={t('chat.thinking')}
        />
      ) : null}

      {showDate ? (
        <span className="shrink-0 text-[11px] leading-[18px] text-muted md:group-hover:hidden">
          {formatShortDate(conversation.updatedAt, language)}
        </span>
      ) : null}

      <div className="flex shrink-0 items-center md:opacity-0 md:transition-opacity md:group-focus-within:opacity-100 md:group-hover:opacity-100">
        <IconButton
          label={t('chats.rename')}
          size="sm"
          onClick={() => {
            setValue(conversation.title);
            setEditing(true);
          }}
        >
          <EditIcon />
        </IconButton>
        <IconButton label={t('chats.delete')} size="sm" onClick={() => setConfirming(true)}>
          <TrashIcon />
        </IconButton>
      </div>
    </div>
  );
}

function ConversationsSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-1">
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} className="h-8 w-full" />
      ))}
    </div>
  );
}
