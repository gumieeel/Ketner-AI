import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ChevronRightIcon, CloseIcon, MenuIcon } from '@/components/icons';
import { buttonClasses } from '@/components/ui/button-classes';
import { IconButton } from '@/components/ui/icon-button';
import { useAuth } from '@/features/auth/auth-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { Brand } from './brand';
import { LanguageToggle } from './language-toggle';
import { HeaderMenu } from './header-menu';
import { ThemeToggle } from './theme-toggle';

const navLinkClass =
  'inline-flex h-9 items-center rounded-sm px-3 text-[14px] text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-text';

const footerLinkClass =
  'inline-flex min-h-8 items-center text-[14px] text-muted transition-colors duration-150 hover:text-text max-md:min-h-11';

const footerHeadClass = 'text-[13px] text-subtle';

/**
 * Каркас страниц вне приложения: лендинг, вход, тарифы, оформление подписки, документация.
 */
export function StandaloneLayout() {
  const { t } = useTranslation();
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

  // Скроллить в начало страницы при переходе между страницами (если нет якоря #hash)
  useEffect(() => {
    if (!location.hash) {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  }, [location.pathname]);

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

  const isAuthPage = location.pathname === '/login' || location.pathname === '/signup';
  const isLanding = location.pathname === '/';
  // Главная шире и с узкими полями — панели идут почти от края до края, как витрина.
  const containerClass = isLanding
    ? 'max-w-[1360px] px-3 sm:px-4 lg:px-5'
    : 'max-w-[1200px] px-4 sm:px-6 lg:px-8';

  if (isAuthPage) {
    return (
      <main className="min-h-screen bg-canvas text-text selection:bg-accent/20 selection:text-text">
        <Outlet />
      </main>
    );
  }

  const startLabel =
    status === 'authenticated' && user
      ? user.name
        ? user.name.split(' ')[0]
        : t('nav.toChat')
      : t('nav.start');

  const mobileLinkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'group flex min-h-14 items-center justify-between rounded-md px-4 text-base font-medium transition-colors duration-150',
      isActive ? 'bg-accent-soft text-accent' : 'text-text hover:bg-surface-2',
    );

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-canvas text-text selection:bg-accent/20 selection:text-text">
      {/* Шапка */}
      <header className="sticky top-0 z-40 h-14 w-full border-b border-stroke bg-canvas">
        <div className={cn('mx-auto flex h-full items-center justify-between', containerClass)}>
          <div className="flex items-center gap-6 lg:gap-10">
            <Brand />
            <nav
              aria-label={t('nav.mainNavigation')}
              className="hidden items-center gap-0.5 md:flex"
            >
              <a href="/#spaces" className={navLinkClass}>
                {t('home.navFeatures')}
              </a>
              <a href="/#models" className={navLinkClass}>
                {t('nav.models')}
              </a>
              <Link to="/pricing" className={navLinkClass}>
                {t('nav.pricing')}
              </Link>
              <Link to="/docs" className={navLinkClass}>
                {t('nav.docs')}
              </Link>
            </nav>
          </div>

          {/* Desktop Right Controls */}
          <div className="hidden items-center gap-2 md:flex">
            {status === 'authenticated' && user ? null : (
              <Link to="/login" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
                {t('nav.login')}
              </Link>
            )}
            <Link to="/chat" className={buttonClasses({ variant: 'primary', size: 'sm' })}>
              {startLabel}
            </Link>
            <div className="mx-1.5 h-5 w-px bg-stroke" aria-hidden="true" />
            <LanguageToggle />
            <HeaderMenu />
          </div>

          {/* Mobile Menu Button */}
          <div className="flex items-center gap-1 md:hidden">
            <IconButton
              label={mobileMenuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
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
            className="fixed inset-0 animate-fade-in bg-overlay"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />

          {/* Panel */}
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('nav.mainNavigation')}
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
            className="fixed top-0 right-0 bottom-0 z-50 flex w-[min(88vw,380px)] animate-slide-in-right flex-col overflow-y-auto border-l border-stroke bg-surface p-5 shadow-2xl"
          >
            {/* Шапка Drawer */}
            <div className="flex shrink-0 items-center justify-between pb-4">
              <Brand />
              <IconButton label={t('nav.closeMenu')} size="md" onClick={() => setMobileMenuOpen(false)}>
                <CloseIcon className="size-5" />
              </IconButton>
            </div>

            <nav aria-label={t('nav.mainNavigation')} className="my-2 flex flex-col gap-1">
              <a
                href="/#models"
                onClick={() => setMobileMenuOpen(false)}
                className="group flex min-h-14 items-center justify-between rounded-md px-4 text-base font-medium text-text transition-colors duration-150 hover:bg-surface-2"
              >
                {t('nav.models')}
                <ChevronRightIcon className="size-4 text-subtle transition-transform duration-200 group-hover:translate-x-0.5" />
              </a>
              <NavLink to="/pricing" onClick={() => setMobileMenuOpen(false)} className={mobileLinkClass}>
                {t('nav.pricing')}
                <ChevronRightIcon className="size-4 text-subtle transition-transform duration-200 group-hover:translate-x-0.5" />
              </NavLink>
              <NavLink to="/docs" end onClick={() => setMobileMenuOpen(false)} className={mobileLinkClass}>
                {t('nav.docs')}
                <ChevronRightIcon className="size-4 text-subtle transition-transform duration-200 group-hover:translate-x-0.5" />
              </NavLink>
            </nav>

            {/* Блок действий, прижатый к низу с учётом safe-area */}
            <div className="mt-auto flex shrink-0 flex-col gap-4 border-t border-stroke pt-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <Link
                to="/chat"
                onClick={() => setMobileMenuOpen(false)}
                className={buttonClasses({ variant: 'primary', size: 'lg', fullWidth: true })}
              >
                {t('nav.goToChat')}
              </Link>
              {status === 'authenticated' && user ? null : (
                <div className="grid grid-cols-2 gap-2.5">
                  <Link
                    to="/login"
                    onClick={() => setMobileMenuOpen(false)}
                    className={buttonClasses({ variant: 'outline', size: 'md', fullWidth: true })}
                  >
                    {t('nav.login')}
                  </Link>
                  <Link
                    to="/signup"
                    onClick={() => setMobileMenuOpen(false)}
                    className={buttonClasses({ variant: 'secondary', size: 'md', fullWidth: true })}
                  >
                    {t('nav.signup')}
                  </Link>
                </div>
              )}

              <div className="flex items-center justify-between">
                <LanguageToggle />
                <ThemeToggle />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Контент страницы */}
      <main
        className={cn(
          'relative z-10 mx-auto flex w-full flex-1 flex-col',
          containerClass,
          isLanding ? 'pt-3 pb-8' : 'py-8 md:py-12',
        )}
      >
        <Outlet />
      </main>

      {/* Футер: колонки ссылок и крупный знак Ketner */}
      <footer className="relative z-10 mt-20 w-full border-t border-stroke text-left">
        <div className={cn('mx-auto flex flex-col gap-12 pt-14', containerClass)}>
          <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
            <div className="col-span-2 flex flex-col gap-4 md:col-span-1">
              <Brand />
              <p className="max-w-[28ch] text-[14px] leading-relaxed text-muted">{t('home.footerTagline')}</p>
            </div>

            <nav aria-label={t('home.footerProduct')} className="flex flex-col gap-3">
              <span className={footerHeadClass}>{t('home.footerProduct')}</span>
              <ul className="flex flex-col gap-1.5 max-md:gap-0">
                <li>
                  <Link to="/chat" className={footerLinkClass}>
                    {t('nav.chat')}
                  </Link>
                </li>
                <li>
                  <Link to="/code" className={footerLinkClass}>
                    {t('nav.code')}
                  </Link>
                </li>
                <li>
                  <Link to="/images" className={footerLinkClass}>
                    {t('nav.images')}
                  </Link>
                </li>
                <li>
                  <a href="/#models" className={footerLinkClass}>
                    {t('home.footerLimits')}
                  </a>
                </li>
                <li>
                  <Link to="/pricing" className={footerLinkClass}>
                    {t('nav.pricing')}
                  </Link>
                </li>
              </ul>
            </nav>

            <nav aria-label={t('home.footerResources')} className="flex flex-col gap-3">
              <span className={footerHeadClass}>{t('home.footerResources')}</span>
              <ul className="flex flex-col gap-1.5 max-md:gap-0">
                <li>
                  <Link to="/docs" className={footerLinkClass}>
                    {t('nav.docs')}
                  </Link>
                </li>
                <li>
                  <Link to="/docs/api" className={footerLinkClass}>
                    {t('nav.apiDocs')}
                  </Link>
                </li>
                <li>
                  <a href="/#faq" className={footerLinkClass}>
                    {t('footer.faq')}
                  </a>
                </li>
                <li>
                  <Link to="/terms" className={footerLinkClass}>
                    Соглашение и оферта
                  </Link>
                </li>
                <li>
                  <Link to="/privacy" className={footerLinkClass}>
                    Конфиденциальность
                  </Link>
                </li>
                <li>
                  <Link to="/payment-terms" className={footerLinkClass}>
                    Оплата и возврат
                  </Link>
                </li>
                <li>
                  <Link to="/contacts" className={footerLinkClass}>
                    Контакты
                  </Link>
                </li>
              </ul>
            </nav>

            <nav aria-label={t('home.footerAccount')} className="flex flex-col gap-3">
              <span className={footerHeadClass}>{t('home.footerAccount')}</span>
              <ul className="flex flex-col gap-1.5 max-md:gap-0">
                <li>
                  <Link to="/login" className={footerLinkClass}>
                    {t('nav.login')}
                  </Link>
                </li>
                <li>
                  <Link to="/signup" className={footerLinkClass}>
                    {t('nav.signup')}
                  </Link>
                </li>
                <li>
                  <Link to="/settings" className={footerLinkClass}>
                    {t('settings.title')}
                  </Link>
                </li>
              </ul>
            </nav>
          </div>

          {/* Крупный знак — логотип во всю ширину. Текст в псевдоэлементе: он декоративный и не читается вслух */}
          <div aria-hidden="true" className="select-none overflow-hidden">
            <span
              data-wordmark="Ketner"
              className="sharp block text-[clamp(5rem,29.5vw,27.5rem)] leading-[0.78] font-medium tracking-[-0.055em] text-surface-3 before:content-[attr(data-wordmark)]"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-stroke py-6 text-[14px] text-muted">
            <span>{t('footer.rights', { year: new Date().getFullYear() })}</span>
            <div className="flex items-center gap-2">
              <LanguageToggle />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
