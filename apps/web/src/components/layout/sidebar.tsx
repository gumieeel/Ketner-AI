import { useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  CloseIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SparkleIcon,
  UserIcon,
} from '@/components/icons';
import { IconButton } from '@/components/ui/icon-button';
import { usePreferences } from '@/features/preferences/preferences-store';
import { cn } from '@/lib/cn';
import { useTranslation } from '@/i18n';
import { Brand } from './brand';
import { LanguageToggle } from './language-toggle';
import { ThemeToggle } from './theme-toggle';

const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
    isActive
      ? 'bg-zinc-200/70 font-medium text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50'
      : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
  );

export function Sidebar() {
  const { t } = useTranslation();
  const open = usePreferences((state) => state.sidebarOpen);
  const setOpen = usePreferences((state) => state.setSidebarOpen);
  const close = () => setOpen(false);

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
            onClick={close}
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
              aria-label={t('nav.searchChats')}
              placeholder={t('nav.searchChats')}
              className={cn(
                'h-9 w-full rounded-lg border border-zinc-300 bg-white pr-3 pl-9 text-sm',
                'placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:placeholder:text-zinc-500',
              )}
            />
          </div>
        </div>

        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3">
          <p className="px-3 py-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            {t('nav.chats')}
          </p>
          <div className="rounded-lg border border-dashed border-zinc-300 px-3 py-6 text-center dark:border-zinc-600">
            <SparkleIcon className="mx-auto mb-2 text-xl text-zinc-400" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('nav.empty')}</p>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{t('nav.emptyHint')}</p>
          </div>
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
            <ThemeToggle />
          </div>

          <LanguageToggle className="self-start" />
        </div>
      </aside>
    </>
  );
}
