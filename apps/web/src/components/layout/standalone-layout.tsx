import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { BalanceChip } from './balance-chip';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ChevronRightIcon, CloseIcon, MenuIcon } from '@/components/icons';
import { buttonClasses } from '@/components/ui/button-classes';
import { IconButton } from '@/components/ui/icon-button';
import { useAuth } from '@/features/auth/auth-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { siteFeatures } from '@/lib/features';
import { DEFAULT_TITLE, seoTitleFor } from '@/lib/seo-pages';
import { sectionLinks } from '@/lib/site-links';
import { Brand } from './brand';
import { LanguageToggle } from './language-toggle';
import { STAGE_GUTTER } from './stage';
import { ThemeToggle } from './theme-toggle';
import { appHomePath, productSwitch } from '@/lib/product-switches';

const navLinkClass =
  'inline-flex h-10 items-center rounded-full px-4 text-[14px] text-muted transition-colors duration-200 hover:bg-surface-2/70 hover:text-text';

/** Пункт шапки платформы решений: текущий раздел подсвечен (aria-current ставит NavLink). */
const desktopNavClass = ({ isActive }: { isActive: boolean }) =>
  cn(navLinkClass, isActive && 'bg-surface-2 text-text');

const footerLinkClass =
  'inline-flex min-h-8 items-center text-[14px] text-muted transition-colors duration-150 hover:text-text max-md:min-h-11';

const footerHeadClass = 'text-[13px] text-subtle';

/** Страница прокручена хотя бы немного: шапка из прозрачной становится плотной. */
function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > threshold);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [threshold]);
  return scrolled;
}

/**
 * Каркас страниц вне приложения: лендинг, вход, кредиты, оформление покупки, документация.
 */
export function StandaloneLayout() {
  const { t } = useTranslation();
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const location = useLocation();
  const scrolled = useScrolled();

  useFocusTrap(drawerRef, mobileMenuOpen);

  // Заголовок вкладки при переходах внутри сайта — тот же, что сервер пишет в HTML (seo-pages.json).
  // Эффект разметки срабатывает раньше обычных эффектов страниц, поэтому страница вне списка
  // (например, «Оплата прошла») может поставить свой заголовок через useDocumentTitle.
  useLayoutEffect(() => {
    document.title = seoTitleFor(location.pathname) ?? DEFAULT_TITLE;
  }, [location.pathname]);

  // Закрывать мобильное меню при переходе между страницами
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, location.hash]);

  // Скроллить в начало страницы при переходе между страницами (если нет якоря #hash).
  // Смена одного только якоря на той же странице прокрутку наверх не вызывает.
  const scrollToTopUnlessAnchor = useEffectEvent(() => {
    if (!location.hash) {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  });
  useEffect(() => {
    scrollToTopUnlessAnchor();
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

  // Вход, регистрация, ввод кода из письма и восстановление пароля — свой каркас (AuthShell),
  // без шапки и подвала сайта.
  const isAuthPage = /^\/(signup(\/verify)?|login(\/verify|\/forgot(\/verify|\/new)?)?)\/?$/.test(
    location.pathname,
  );
  // Чат закрыт (lib/product-switches.ts) — главная та же, что у платформы решений, и шапка тоже.
  const discovery = siteFeatures().discovery || !productSwitch('chat');
  const links = sectionLinks();
  // Прозрачная шапка поверх первого экрана — только у лендинга агрегатора. У главной платформы
  // решений шапка обычная, компактная.
  const isLanding = location.pathname === '/' && !discovery;
  // Главная — витрина на всю ширину: шапка прозрачная и лежит поверх первого экрана.
  const containerClass = 'max-w-[1200px] px-4 sm:px-6 lg:px-8';
  const headerContainerClass = isLanding ? `max-w-[1920px] ${STAGE_GUTTER}` : containerClass;
  const stageContainerClass = `max-w-[1920px] ${STAGE_GUTTER}`;

  if (isAuthPage) {
    return (
      <main className="min-h-screen bg-canvas text-text selection:bg-accent/20 selection:text-text">
        <Outlet />
      </main>
    );
  }

  const signedIn = status === 'authenticated' && Boolean(user);
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
      {/* Шапка: при первой загрузке мягко опускается из-под верхней кромки */}
      <header
        className={cn(
          'animate-site-in sticky top-0 z-40 w-full border-b transition-[background-color,border-color,backdrop-filter] duration-300',
          isLanding ? 'h-[72px] -mb-[72px] md:h-[88px] md:-mb-[88px]' : 'h-16',
          isLanding && !scrolled
            ? 'border-transparent bg-transparent'
            : 'border-stroke bg-canvas/85 backdrop-blur-xl',
        )}
      >
        <div
          className={cn('mx-auto flex h-full items-center justify-between', headerContainerClass)}
        >
          <div
            className={cn(
              'flex items-center gap-8',
              discovery ? 'lg:gap-6 xl:gap-14' : 'lg:gap-14',
            )}
          >
            <Brand size={isLanding ? 'lg' : 'md'} />
            <nav aria-label={t('nav.mainNavigation')} className="hidden items-center gap-1 lg:flex">
              {discovery ? (
                <>
                  {/* Главная — Business Discovery: в шапке только то, что помогает начать. */}
                  <Link to="/#how-it-works" className={navLinkClass}>
                    {t('nav.howItWorks')}
                  </Link>
                  <Link to="/#solutions" className={navLinkClass}>
                    {t('nav.industrySolutions')}
                  </Link>
                  {signedIn ? (
                    <>
                      <NavLink to="/analyses" className={desktopNavClass}>
                        {t('nav.analyses')}
                      </NavLink>
                      <NavLink to="/solutions" className={desktopNavClass}>
                        {t('nav.solutions')}
                      </NavLink>
                      <NavLink to="/requests" className={desktopNavClass}>
                        {t('nav.requests')}
                      </NavLink>
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <a href={links.spaces} className={navLinkClass}>
                    {t('home.navFeatures')}
                  </a>
                  <a href={links.models} className={navLinkClass}>
                    {t('nav.models')}
                  </a>
                </>
              )}
              {discovery ? null : (
                <>
                  <Link to="/pricing" className={navLinkClass}>
                    {t('nav.pricing')}
                  </Link>
                  {productSwitch('chat') ? (
                    <Link to="/docs" className={navLinkClass}>
                      {t('nav.docs')}
                    </Link>
                  ) : null}
                </>
              )}
            </nav>
          </div>

          {/* Desktop Right Controls */}
          <div className="hidden items-center gap-2.5 lg:flex">
            {isLanding ? null : (
              <>
                {/* В шапке платформы пять разделов: на 1024–1279 px язык переключается в подвале. */}
                <div className={discovery ? 'hidden xl:block' : undefined}>
                  <LanguageToggle />
                </div>
                <ThemeToggle />
                <div className="mx-1 h-5 w-px bg-stroke" aria-hidden="true" />
              </>
            )}
            {signedIn ? (
              <BalanceChip />
            ) : (
              <Link
                to="/login"
                className={buttonClasses({
                  variant: discovery ? 'primary' : 'outline',
                  size: 'sm',
                })}
              >
                {t('nav.login')}
              </Link>
            )}
            {/* У Business Discovery гостю в шапке нужен только вход: регистрация — после анализа. */}
            {discovery && !signedIn ? null : (
              <Link
                to={signedIn ? appHomePath() : '/signup'}
                className={buttonClasses({ variant: 'primary', size: 'sm' })}
              >
                {signedIn ? startLabel : t('nav.signup')}
              </Link>
            )}
          </div>

          {/* Mobile Menu Button */}
          <div className="flex items-center gap-1 lg:hidden">
            {status === 'authenticated' && user ? <BalanceChip /> : null}
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
        <div className="fixed inset-0 z-50 lg:hidden">
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
              <IconButton
                label={t('nav.closeMenu')}
                size="md"
                onClick={() => setMobileMenuOpen(false)}
              >
                <CloseIcon className="size-5" />
              </IconButton>
            </div>

            <nav aria-label={t('nav.mainNavigation')} className="my-2 flex flex-col gap-1">
              {discovery
                ? (
                    [
                      ['/#how-it-works', 'nav.howItWorks'],
                      ['/#solutions', 'nav.industrySolutions'],
                      ...(signedIn
                        ? ([
                            ['/analyses', 'nav.analyses'],
                            ['/solutions', 'nav.solutions'],
                            ['/requests', 'nav.requests'],
                          ] as const)
                        : []),
                      ...(productSwitch('chat') ? ([['/chat', 'nav.chat']] as const) : []),
                    ] as const
                  ).map(([to, key]) => (
                    <NavLink
                      key={to}
                      to={to}
                      onClick={() => setMobileMenuOpen(false)}
                      // Разделы главной (/#…) не подсвечиваются как текущая страница.
                      className={({ isActive }) =>
                        mobileLinkClass({ isActive: isActive && !to.includes('#') })
                      }
                    >
                      {t(key)}
                      <ChevronRightIcon className="size-4 text-subtle transition-transform duration-200 group-hover:translate-x-0.5" />
                    </NavLink>
                  ))
                : null}
              <a
                href={links.models}
                onClick={() => setMobileMenuOpen(false)}
                className="group flex min-h-14 items-center justify-between rounded-md px-4 text-base font-medium text-text transition-colors duration-150 hover:bg-surface-2"
              >
                {t('nav.models')}
                <ChevronRightIcon className="size-4 text-subtle transition-transform duration-200 group-hover:translate-x-0.5" />
              </a>
              <NavLink
                to="/pricing"
                onClick={() => setMobileMenuOpen(false)}
                className={mobileLinkClass}
              >
                {t('nav.pricing')}
                <ChevronRightIcon className="size-4 text-subtle transition-transform duration-200 group-hover:translate-x-0.5" />
              </NavLink>
              {productSwitch('chat') ? (
                <NavLink
                  to="/docs"
                  end
                  onClick={() => setMobileMenuOpen(false)}
                  className={mobileLinkClass}
                >
                  {t('nav.docs')}
                  <ChevronRightIcon className="size-4 text-subtle transition-transform duration-200 group-hover:translate-x-0.5" />
                </NavLink>
              ) : null}
            </nav>

            {/* Блок действий, прижатый к низу с учётом safe-area */}
            <div className="mt-auto flex shrink-0 flex-col gap-4 border-t border-stroke pt-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <Link
                to={discovery ? '/' : '/chat'}
                onClick={() => setMobileMenuOpen(false)}
                className={buttonClasses({ variant: 'primary', size: 'lg', fullWidth: true })}
              >
                {discovery ? t('nav.describeBusiness') : t('nav.goToChat')}
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

      {/* Контент страницы. Главная сама раскладывает полосы: первый экран идёт во всю ширину. */}
      <main
        className={cn(
          'relative z-10 flex w-full flex-1 flex-col',
          isLanding ? '' : cn('mx-auto py-8 md:py-12', containerClass),
        )}
      >
        <Outlet />
      </main>

      {/* Футер: колонки ссылок и нижняя строка */}
      <footer className="relative z-10 mt-28 w-full text-left">
        <div
          className={cn(
            'mx-auto flex flex-col gap-12 pt-14',
            isLanding ? stageContainerClass : containerClass,
          )}
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
            <div className="col-span-2 flex flex-col gap-4 md:col-span-1">
              <Brand />
              <p className="max-w-[28ch] text-[14px] leading-relaxed text-muted">
                {discovery ? t('discoveryHome.footerTagline') : t('home.footerTagline')}
              </p>
            </div>

            <nav aria-label={t('home.footerProduct')} className="flex flex-col gap-3">
              <span className={footerHeadClass}>{t('home.footerProduct')}</span>
              <ul className="flex flex-col gap-1.5 max-md:gap-0">
                {discovery ? (
                  <>
                    <li>
                      <Link to="/analyses" className={footerLinkClass}>
                        {t('nav.analyses')}
                      </Link>
                    </li>
                    <li>
                      <Link to="/solutions" className={footerLinkClass}>
                        {t('nav.solutions')}
                      </Link>
                    </li>
                  </>
                ) : null}
                {productSwitch('chat') ? (
                  <li>
                    <Link to="/chat" className={footerLinkClass}>
                      {t('nav.chat')}
                    </Link>
                  </li>
                ) : null}
                {productSwitch('code') ? (
                  <li>
                    <Link to="/code" className={footerLinkClass}>
                      {t('nav.code')}
                    </Link>
                  </li>
                ) : null}
                {productSwitch('images') ? (
                  <li>
                    <Link to="/images" className={footerLinkClass}>
                      {t('nav.images')}
                    </Link>
                  </li>
                ) : null}
                {productSwitch('chat') ? (
                  <li>
                    <Link to="/models" className={footerLinkClass}>
                      {t('home.footerLimits')}
                    </Link>
                  </li>
                ) : null}
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
                {productSwitch('chat') ? (
                  <li>
                    <Link to="/docs" className={footerLinkClass}>
                      {t('nav.docs')}
                    </Link>
                  </li>
                ) : null}
                {productSwitch('developerApi') ? (
                  <li>
                    <Link to="/docs/api" className={footerLinkClass}>
                      {t('nav.apiDocs')}
                    </Link>
                  </li>
                ) : null}
                <li>
                  <a href={links.faq} className={footerLinkClass}>
                    {t('footer.faq')}
                  </a>
                </li>
                <li>
                  <Link to="/changelog" className={footerLinkClass}>
                    {t('footer.changelog')}
                  </Link>
                </li>
                <li>
                  <Link to="/status" className={footerLinkClass}>
                    {t('footer.status')}
                  </Link>
                </li>
                <li>
                  <Link to="/about" className={footerLinkClass}>
                    {t('footer.about')}
                  </Link>
                </li>
                <li>
                  <Link to="/terms" className={footerLinkClass}>
                    {t('legal.terms')}
                  </Link>
                </li>
                <li>
                  <Link to="/privacy" className={footerLinkClass}>
                    {t('legal.privacy')}
                  </Link>
                </li>
                <li>
                  <Link to="/payment-terms" className={footerLinkClass}>
                    {t('legal.paymentTerms')}
                  </Link>
                </li>
                <li>
                  <Link to="/contacts" className={footerLinkClass}>
                    {t('legal.contacts')}
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

          <div className="flex flex-wrap items-center justify-between gap-4 py-8 text-[14px] text-muted">
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
