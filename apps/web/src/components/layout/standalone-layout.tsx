import { Link, Outlet } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useAuth } from '@/features/auth/auth-store';
import { useTranslation } from '@/i18n';
import { Brand } from './brand';
import { ThemeToggle } from './theme-toggle';

const linkClasses =
  'rounded-lg px-3 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50';

/** Каркас страниц вне приложения: лендинг, вход, тарифы, оформление подписки. */
export function StandaloneLayout() {
  const { t } = useTranslation();
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);

  return (
    <div className={cn('flex min-h-full flex-col bg-white dark:bg-zinc-900')}>
      <header className="flex h-16 shrink-0 items-center gap-2 px-4 md:px-8">
        <Brand />
        <nav className="ml-auto flex items-center gap-1">
          <Link to="/pricing" className={linkClasses}>
            {t('nav.pricing')}
          </Link>
          <Link to="/docs" className={linkClasses}>
            {t('nav.docs')}
          </Link>
          {status === 'authenticated' ? (
            <Link to="/chat" className={linkClasses}>
              {user?.name ? user.name.split(' ')[0] : 'В чат'}
            </Link>
          ) : (
            <Link to="/login" className={linkClasses}>
              {t('nav.login')}
            </Link>
          )}
          <ThemeToggle />
        </nav>
      </header>

      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>

      <footer className="flex flex-wrap items-center justify-center gap-3 px-4 py-6 text-center text-xs text-zinc-500 md:px-8 dark:text-zinc-400">
        <span>
          {t('app.name')} — {t('landing.mockBadge')}
        </span>
        <span>•</span>
        <Link to="/docs" className="underline hover:text-text transition-colors">
          {t('nav.docs')}
        </Link>
      </footer>
    </div>
  );
}
