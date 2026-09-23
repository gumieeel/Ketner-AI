import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
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
    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
    isActive
      ? 'bg-zinc-200/70 font-medium text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50'
      : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
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
  const close = () => setOpen(false);

  const handleNewChat = () => {
    void openConversation(undefined);
    close();
  };

  useEffect(() => {
    if (!open) {
      return;
    }
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
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
        />
      ) : null}

      <aside
        aria-label={t('nav.chats')}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-zinc-200 bg-zinc-50',
          'transition-transform duration-200 md:static md:z-auto md:translate-x-0',
          'dark:border-zinc-700 dark:bg-zinc-800/60',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center gap-2 px-3">
          <Brand />
          <IconButton
            label={t('nav.closeSidebar')}
            size="sm"
            className="ml-auto md:hidden"
            onClick={close}
          >
            <CloseIcon />
          </IconButton>
        </div>

        <div className="flex flex-col gap-3 px-3">
          <Link
            to="/chat"
            onClick={handleNewChat}
            className={cn(
              'inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors',
              'border border-zinc-300 text-zinc-800 hover:bg-zinc-100',
              'dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-700',
            )}
          >
            <PlusIcon className="text-lg" />
            {t('nav.newChat')}
          </Link>

          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base text-zinc-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={t('nav.searchChats')}
              placeholder={t('nav.searchChats')}
              className={cn(
                'h-9 w-full rounded-lg border border-zinc-300 bg-white pr-3 pl-9 text-sm',
                'placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:placeholder:text-zinc-500',
              )}
            />
          </div>
        </div>

        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-2">
          <p className="px-3 py-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            {t('nav.chats')}
          </p>

          {status === 'loading' ? <ConversationsSkeleton /> : null}

          {status === 'error' ? (
            <div className="rounded-lg border border-red-200 px-3 py-4 text-center dark:border-red-900/60">
              <p className="text-sm text-red-700 dark:text-red-300">{t('chats.loadError')}</p>
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
            <div className="rounded-lg border border-dashed border-zinc-300 px-3 py-6 text-center dark:border-zinc-600">
              <SparkleIcon className="mx-auto mb-2 text-xl text-zinc-400" />
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('nav.empty')}</p>
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{t('nav.emptyHint')}</p>
            </div>
          ) : null}

          {status !== 'loading' &&
          status !== 'error' &&
          conversations.length > 0 &&
          groups.length === 0 ? (
            <p className="px-3 py-4 text-sm text-zinc-500 dark:text-zinc-400">
              {t('chat.searchEmpty')}
            </p>
          ) : null}

          {groups.map(({ group, items }) => (
            <section key={group} className="flex flex-col gap-1">
              <p className="px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
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

        <div className="flex flex-col gap-2 border-t border-zinc-200 p-3 dark:border-zinc-700">
          <NavLink to="/settings" onClick={close} className={navLinkClasses}>
            <SettingsIcon className="text-lg" />
            {t('nav.settings')}
          </NavLink>
          <NavLink to="/pricing" onClick={close} className={navLinkClasses}>
            <SparkleIcon className="text-lg" />
            {t('nav.upgrade')}
          </NavLink>

          <div className="flex items-center gap-2 rounded-lg px-1 py-1">
            {user ? (
              <>
                <Link
                  to="/settings"
                  onClick={close}
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700 hover:opacity-80 dark:bg-brand-900/60 dark:text-brand-300"
                  title={user.name}
                >
                  {user.name.slice(0, 2).toUpperCase()}
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    to="/settings"
                    onClick={close}
                    className="block truncate text-sm font-medium text-zinc-800 hover:underline dark:text-zinc-100"
                  >
                    {user.name}
                  </Link>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {user.plan === 'free' ? t('pricing.free') : user.plan.toUpperCase()}
                  </p>
                </div>
              </>
            ) : (
              <>
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300">
                  <UserIcon className="text-lg" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                    {t('nav.guest')}
                  </p>
                  <Link
                    to="/login"
                    onClick={close}
                    className="text-xs text-brand-600 dark:text-brand-300"
                  >
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
        className="flex items-center gap-1 px-1"
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
          className="h-8 min-w-0 flex-1 rounded-lg border border-brand-500 bg-white px-2 text-sm outline-none dark:bg-zinc-800"
        />
        <IconButton label={t('common.save')} size="sm" type="submit">
          <CheckIcon />
        </IconButton>
      </form>
    );
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 dark:bg-red-950/40">
        <span className="min-w-0 flex-1 truncate text-xs text-red-700 dark:text-red-300">
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
          className="rounded-md px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900/40"
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
        'group flex items-center gap-1 rounded-lg pr-1 transition-colors',
        active ? 'bg-zinc-200/70 dark:bg-zinc-700' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
      )}
    >
      <NavLink
        to={`/chat/${conversation.id}`}
        onClick={onNavigate}
        title={conversation.title}
        className={cn(
          'min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-sm',
          active
            ? 'font-medium text-zinc-900 dark:text-zinc-50'
            : 'text-zinc-600 dark:text-zinc-300',
        )}
      >
        {conversation.title === '' ? t('chat.title') : conversation.title}
      </NavLink>

      {showDate ? (
        <span className="shrink-0 text-[11px] text-zinc-400 md:group-hover:hidden dark:text-zinc-500">
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
