import { Link, Outlet } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useAuth } from '@/features/auth/auth-store';
import { useTranslation } from '@/i18n';
import { Brand } from './brand';
import { ThemeToggle } from './theme-toggle';

/** Каркас страниц вне приложения: лендинг, вход, тарифы, оформление подписки. */
export function StandaloneLayout() {
  const { t, language } = useTranslation();
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);

  return (
    <div className={cn('relative flex min-h-full flex-col bg-canvas text-text')}>
      {/* Полноэкранный фоновый градиент без швов и обрезки */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-ambient-mesh opacity-90 transition-opacity" />

      <header className="relative z-20 flex h-16 shrink-0 items-center gap-2 border-b border-stroke bg-canvas/80 px-4 backdrop-blur-md md:px-8">
        <Brand />
        <nav className="ml-auto flex items-center gap-2 sm:gap-4">
          <a
            href="#models"
            className="rounded-lg px-2.5 py-1.5 text-xs sm:text-sm font-medium text-slate-300 hover:text-white transition-colors"
          >
            {language === 'ru' ? 'Модели' : 'Models'}
          </a>
          <Link
            to="/pricing"
            className="rounded-lg px-2.5 py-1.5 text-xs sm:text-sm font-medium text-slate-300 hover:text-white transition-colors"
          >
            {t('nav.pricing')}
          </Link>
          <Link
            to="/docs"
            className="rounded-lg px-2.5 py-1.5 text-xs sm:text-sm font-medium text-slate-300 hover:text-white transition-colors"
          >
            {t('nav.docs')}
          </Link>
          {status === 'authenticated' ? (
            <Link
              to="/chat"
              className="rounded-lg bg-emerald-400 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-300 transition-colors shadow-sm"
            >
              {user?.name ? user.name.split(' ')[0] : (language === 'ru' ? 'В чат' : 'Chat')}
            </Link>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                to="/login"
                className="rounded-lg border border-slate-700/60 bg-surface/50 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-surface hover:text-white transition-colors"
              >
                {t('nav.login')}
              </Link>
              <Link
                to="/login"
                className="rounded-lg bg-emerald-400 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-300 transition-colors shadow-sm"
              >
                {language === 'ru' ? 'Начать' : 'Start'}
              </Link>
            </div>
          )}
          <ThemeToggle />
        </nav>
      </header>

      <main className="relative z-10 flex flex-1 flex-col">
        <Outlet />
      </main>

      <footer className="relative z-10 flex flex-wrap items-center justify-center gap-3 border-t border-stroke bg-canvas/50 px-4 py-6 text-center text-xs text-muted backdrop-blur-sm md:px-8">
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
