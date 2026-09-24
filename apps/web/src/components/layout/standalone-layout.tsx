import { Link, Outlet } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useAuth } from '@/features/auth/auth-store';
import { useTranslation } from '@/i18n';
import { Brand } from './brand';
import { ThemeToggle } from './theme-toggle';

const linkClasses =
  'rounded-lg px-3 py-2 text-sm text-muted font-medium transition-colors hover:bg-surface hover:text-text';

/** Каркас страниц вне приложения: лендинг, вход, тарифы, оформление подписки. */
export function StandaloneLayout() {
  const { t } = useTranslation();
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);

  return (
    <div className={cn('relative flex min-h-full flex-col bg-canvas text-text')}>
      {/* Полноэкранный фоновый градиент без швов и обрезки */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-ambient-mesh opacity-90 transition-opacity" />

      <header className="relative z-20 flex h-16 shrink-0 items-center gap-2 border-b border-stroke/15 bg-canvas/80 px-4 backdrop-blur-md md:px-8">
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

      <main className="relative z-10 flex flex-1 flex-col">
        <Outlet />
      </main>

      <footer className="relative z-10 flex flex-wrap items-center justify-center gap-3 border-t border-stroke/10 bg-canvas/50 px-4 py-6 text-center text-xs text-muted backdrop-blur-sm md:px-8">
        <span>
          {t('app.name')} — {t('landing.mockBadge')}
        </span>
        <span>•</span>
        <Link to="/docs" className="underline hover:text-text transition-colors">
          {t('nav.docs')}
        </Link>
        <span>•</span>
        <Link to="/pricing" className="underline hover:text-text transition-colors">
          {t('nav.pricing')}
        </Link>
      </footer>
    </div>
  );
}
