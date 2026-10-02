import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { CloseIcon, MenuIcon } from '@/components/icons';
import { IconButton } from '@/components/ui/icon-button';
import { useAuth } from '@/features/auth/auth-store';
import { useTranslation } from '@/i18n';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { Brand } from './brand';
import { LanguageToggle } from './language-toggle';
import { ThemeToggle } from './theme-toggle';

/**
 * Каркас страниц вне приложения: лендинг, вход, тарифы, оформление подписки, документация.
 */
export function StandaloneLayout() {
  const { t, language } = useTranslation();
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const location = useLocation();

  useFocusTrap(drawerRef, mobileMenuOpen);

  // Закрывать мобильное меню при переходе между страницами
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, location.hash]);

  // Закрывать по Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  // Блокировать скролл страницы при открытом меню
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  return (
    <div className="relative flex min-h-screen flex-col bg-canvas text-text selection:bg-accent/20 selection:text-text">
      {/* Шапка */}
      <header className="sticky top-0 z-40 h-14 w-full border-b border-stroke bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex h-full max-w-[1200px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-8">
            <Brand />
            <nav className="hidden md:flex items-center gap-6 font-mono text-xs uppercase tracking-wider text-muted">
              <a
                href="/#models"
                className="transition-colors hover:text-text"
              >
                {language === 'ru' ? 'Модели' : 'Models'}
              </a>
              <Link
                to="/pricing"
                className="transition-colors hover:text-text"
              >
                {t('nav.pricing')}
              </Link>
              <Link
                to="/docs"
                className="transition-colors hover:text-text"
              >
                {t('nav.docs')}
              </Link>
            </nav>
          </div>

          {/* Desktop Right Controls */}
          <div className="hidden md:flex items-center gap-3">
            {status === 'authenticated' && user ? (
              <Link
                to="/chat"
                className="inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium text-[13px] h-8 px-3 bg-accent text-accent-text hover:bg-accent-hover transition-colors"
              >
                {user.name ? user.name.split(' ')[0] : (language === 'ru' ? 'В чат' : 'Chat')}
              </Link>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium text-[13px] h-8 px-3 text-muted hover:text-text hover:bg-surface-2 transition-colors"
                >
                  {t('nav.login')}
                </Link>
                <Link
                  to="/chat"
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium text-[13px] h-8 px-3 bg-accent text-accent-text hover:bg-accent-hover transition-colors"
                >
                  {language === 'ru' ? 'Начать' : 'Start'}
                </Link>
              </div>
            )}

            <div className="h-4 w-px bg-stroke mx-1" />
            <LanguageToggle />
            <ThemeToggle />
          </div>

          {/* Mobile Menu Button */}
          <div className="flex md:hidden items-center gap-2">
            <ThemeToggle />
            <IconButton
              label={mobileMenuOpen ? 'Закрыть меню' : 'Открыть меню'}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <CloseIcon className="size-5" /> : <MenuIcon className="size-5" />}
            </IconButton>
          </div>
        </div>
      </header>

      {/* Мобильное всплывающее меню (Drawer) */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />

          {/* Panel */}
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Навигация"
            onTouchStart={(e) => {
              touchStartX.current = e.touches[0].clientX;
            }}
            onTouchEnd={(e) => {
              if (touchStartX.current !== null) {
                const deltaX = e.changedTouches[0].clientX - touchStartX.current;
                // Свайп влево закрывает меню
                if (deltaX < -45) {
                  setMobileMenuOpen(false);
                }
                touchStartX.current = null;
              }
            }}
            className="fixed top-0 right-0 bottom-0 w-[min(85vw,360px)] border-l border-stroke bg-canvas p-6 flex flex-col shadow-2xl z-50 animate-slide-in-right overflow-y-auto"
          >
            {/* Шапка Drawer */}
            <div className="flex items-center justify-between pb-4 border-b border-stroke shrink-0">
              <Brand />
              <IconButton
                label="Закрыть меню"
                size="md"
                onClick={() => setMobileMenuOpen(false)}
              >
                <CloseIcon className="size-5" />
              </IconButton>
            </div>

            {/* Пункты меню: py-4, активный с левой полоской */}
            <nav className="flex flex-col font-mono text-sm uppercase tracking-wider text-muted divide-y divide-stroke/30 my-4">
              <a
                href="/#models"
                onClick={() => setMobileMenuOpen(false)}
                className="py-4 pl-3.5 -ml-3.5 transition-colors hover:text-text border-l-2 border-transparent"
              >
                {language === 'ru' ? 'Модели' : 'Models'}
              </a>
              <Link
                to="/pricing"
                onClick={() => setMobileMenuOpen(false)}
                className={`py-4 pl-3.5 -ml-3.5 transition-colors ${
                  location.pathname === '/pricing'
                    ? 'border-l-2 border-accent text-accent font-semibold bg-accent-soft/30'
                    : 'border-l-2 border-transparent hover:text-text'
                }`}
              >
                {t('nav.pricing')}
              </Link>
              <Link
                to="/docs"
                onClick={() => setMobileMenuOpen(false)}
                className={`py-4 pl-3.5 -ml-3.5 transition-colors ${
                  location.pathname === '/docs'
                    ? 'border-l-2 border-accent text-accent font-semibold bg-accent-soft/30'
                    : 'border-l-2 border-transparent hover:text-text'
                }`}
              >
                {t('nav.docs')}
              </Link>
              <Link
                to="/chat"
                onClick={() => setMobileMenuOpen(false)}
                className={`py-4 pl-3.5 -ml-3.5 transition-colors ${
                  location.pathname === '/chat'
                    ? 'border-l-2 border-accent text-accent font-semibold bg-accent-soft/30'
                    : 'border-l-2 border-transparent text-accent font-semibold hover:opacity-85'
                }`}
              >
                {language === 'ru' ? 'Чат' : 'Chat'}
              </Link>
            </nav>

            {/* Блок действий, прижатый к низу с учетом safe-area */}
            <div className="mt-auto pt-6 border-t border-stroke flex flex-col gap-4 pb-[max(1rem,env(safe-area-inset-bottom))] shrink-0">
              {status === 'authenticated' && user ? (
                <Link
                  to="/chat"
                  onClick={() => setMobileMenuOpen(false)}
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium text-sm h-11 px-4 bg-accent text-accent-text hover:bg-accent-hover transition-colors w-full shadow-sm"
                >
                  {language === 'ru' ? 'Перейти в чат' : 'Go to Chat'}
                </Link>
              ) : (
                <div className="flex flex-col gap-2.5">
                  <Link
                    to="/chat"
                    onClick={() => setMobileMenuOpen(false)}
                    className="inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium text-sm h-11 px-4 bg-accent text-accent-text hover:bg-accent-hover transition-colors w-full shadow-sm"
                  >
                    {language === 'ru' ? 'Перейти в чат' : 'Go to Chat'}
                  </Link>
                  <div className="grid grid-cols-2 gap-2">
                    <Link
                      to="/login"
                      onClick={() => setMobileMenuOpen(false)}
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium text-xs h-10 px-3 border border-stroke text-text hover:bg-surface-2 transition-colors"
                    >
                      {t('nav.login')}
                    </Link>
                    <Link
                      to="/signup"
                      onClick={() => setMobileMenuOpen(false)}
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium text-xs h-10 px-3 bg-surface-2 text-text hover:bg-surface-3 transition-colors border border-stroke"
                    >
                      {language === 'ru' ? 'Регистрация' : 'Sign up'}
                    </Link>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <LanguageToggle />
                <ThemeToggle />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Контент страницы */}
      <main className="relative z-10 flex flex-1 flex-col mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        <Outlet />
      </main>

      {/* Футер */}
      <footer className="relative z-10 w-full border-t border-stroke bg-canvas py-12 text-left">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 flex flex-col gap-10">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {/* 1. Колонка: Бренд */}
            <div className="flex flex-col gap-3">
              <Brand />
              <p className="text-xs text-muted leading-relaxed max-w-[26ch]">
                {language === 'ru'
                  ? 'Единая платформа для работы со всеми передовыми AI-моделями мира.'
                  : 'Unified platform for working with all top-tier world AI models.'}
              </p>
            </div>

            {/* 2. Колонка: Продукт */}
            <div className="flex flex-col gap-2.5">
              <span className="font-mono text-xs uppercase tracking-wider text-text font-semibold">
                {language === 'ru' ? 'Продукт' : 'Product'}
              </span>
              <ul className="flex flex-col gap-2 text-xs text-muted">
                <li>
                  <Link to="/chat" className="hover:text-text transition-colors">
                    {language === 'ru' ? 'Чат' : 'Chat'}
                  </Link>
                </li>
                <li>
                  <Link to="/pricing" className="hover:text-text transition-colors">
                    {t('nav.pricing')}
                  </Link>
                </li>
                <li>
                  <a href="/#models" className="hover:text-text transition-colors">
                    {language === 'ru' ? 'Все модели' : 'All models'}
                  </a>
                </li>
              </ul>
            </div>

            {/* 3. Колонка: Ресурсы */}
            <div className="flex flex-col gap-2.5">
              <span className="font-mono text-xs uppercase tracking-wider text-text font-semibold">
                {language === 'ru' ? 'Ресурсы' : 'Resources'}
              </span>
              <ul className="flex flex-col gap-2 text-xs text-muted">
                <li>
                  <Link to="/docs" className="hover:text-text transition-colors">
                    {t('nav.docs')}
                  </Link>
                </li>
                <li>
                  <Link to="/docs#api" className="hover:text-text transition-colors">
                    {language === 'ru' ? 'API & SDK' : 'API & SDK'}
                  </Link>
                </li>
                <li>
                  <a href="/#faq" className="hover:text-text transition-colors">
                    FAQ
                  </a>
                </li>
              </ul>
            </div>

            {/* 4. Колонка: Аккаунт */}
            <div className="flex flex-col gap-2.5">
              <span className="font-mono text-xs uppercase tracking-wider text-text font-semibold">
                {language === 'ru' ? 'Аккаунт' : 'Account'}
              </span>
              <ul className="flex flex-col gap-2 text-xs text-muted">
                <li>
                  <Link to="/login" className="hover:text-text transition-colors">
                    {t('nav.login')}
                  </Link>
                </li>
                <li>
                  <Link to="/signup" className="hover:text-text transition-colors">
                    {language === 'ru' ? 'Регистрация' : 'Sign up'}
                  </Link>
                </li>
                <li>
                  <Link to="/settings" className="hover:text-text transition-colors">
                    {t('settings.title')}
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          {/* Нижняя полоса */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-6 border-t border-stroke text-xs text-muted">
            <div className="flex flex-wrap items-center gap-3">
              <span>© {new Date().getFullYear()} Ketner AI</span>
            </div>

            <div className="flex items-center gap-3">
              <LanguageToggle />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
