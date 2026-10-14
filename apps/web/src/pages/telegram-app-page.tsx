import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CloseIcon, FileTextIcon, ShieldIcon, SparkleIcon, StarIcon, TelegramIcon, UserIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, miniAppApi, type MiniAppState } from '@/features/telegram/api';
import { haptic, loadTelegramWebApp, paintTelegramChrome, type TelegramWebApp } from '@/features/telegram/webapp';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { AdminTab } from './telegram-app/admin-tab';
import { HomeTab } from './telegram-app/home-tab';
import { Onboarding } from './telegram-app/onboarding';
import { PaymentsTab } from './telegram-app/payments-tab';
import { PlansTab } from './telegram-app/plans-tab';
import { ProfileTab } from './telegram-app/profile-tab';
import { BOT_URL, MiniAppProvider, Panel, PLAN_TONE, subscriptionInfo, type MiniApp, type TabId } from './telegram-app/shared';

type Screen =
  | { kind: 'loading' }
  | { kind: 'outside' }
  | { kind: 'error'; message: string }
  | { kind: 'onboarding'; firstName: string; siteUrl: string }
  | { kind: 'ready'; token: string; state: MiniAppState };

interface Toast {
  id: number;
  tone: 'success' | 'danger' | 'info';
  text: string;
}

const TABS: Array<{ id: TabId; label: TranslationKey; icon: (props: { className?: string }) => ReactNode }> = [
  { id: 'home', label: 'tg.tabHome', icon: SparkleIcon },
  { id: 'plans', label: 'tg.tabPlans', icon: StarIcon },
  { id: 'payments', label: 'tg.tabPayments', icon: FileTextIcon },
  { id: 'profile', label: 'tg.tabProfile', icon: UserIcon },
  { id: 'admin', label: 'tg.tabAdmin', icon: ShieldIcon },
];

const TAB_IDS = new Set<string>(TABS.map((tab) => tab.id));

/** Вкладка из ссылки бота (`/tg?tab=plans`) или из start_param (`t.me/bot/app?startapp=plans`). */
function initialTab(app: TelegramWebApp | null): TabId {
  const fromQuery = new URLSearchParams(window.location.search).get('tab');
  const fromStart = app?.initDataUnsafe.start_param;
  const value = fromQuery ?? fromStart ?? 'home';
  return TAB_IDS.has(value) ? (value as TabId) : 'home';
}

/**
 * Кабинет Ketner AI внутри Telegram (мини-приложение бота): подписка и автопродление,
 * оплата звёздами, чеки и возвраты, уведомления и вход на сайт в одно касание.
 */
export function TelegramAppPage() {
  const { t } = useTranslation();
  const theme = usePreferences((state) => state.theme);
  const setTheme = usePreferences((state) => state.setTheme);
  const setLanguage = usePreferences((state) => state.setLanguage);
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [app, setApp] = useState<TelegramWebApp | null>(null);
  // Язык переключается после запуска (по языку Telegram): текст ошибки берётся актуальный,
  // а сессия из-за смены языка заново не запрашивается.
  const tRef = useRef(t);
  tRef.current = t;
  const started = useRef(false);

  const openSession = useCallback(async (webApp: TelegramWebApp) => {
    try {
      const session = await miniAppApi.session(webApp.initData);
      if (session.linked) setScreen({ kind: 'ready', token: session.token, state: session });
      else setScreen({ kind: 'onboarding', firstName: session.telegram.firstName, siteUrl: session.siteUrl });
    } catch (error) {
      setScreen({ kind: 'error', message: error instanceof ApiError ? error.message : tRef.current('tg.errorGeneric') });
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void loadTelegramWebApp().then((webApp) => {
      if (!webApp) {
        setScreen({ kind: 'outside' });
        return;
      }
      setApp(webApp);
      webApp.ready();
      webApp.expand();
      setTheme(webApp.colorScheme === 'light' ? 'light' : 'dark');
      const code = webApp.initDataUnsafe.user?.language_code ?? '';
      setLanguage(/^(ru|uk|be|kk)/.test(code) ? 'ru' : code ? 'en' : 'ru');
      void openSession(webApp);
    });
  }, [openSession, setLanguage, setTheme]);

  // Шапка и фон Telegram в цвет кабинета.
  useEffect(() => {
    if (!app) return;
    const frame = window.requestAnimationFrame(() => {
      const canvas = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim();
      paintTelegramChrome(app, canvas);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [app, theme]);

  return (
    <main className="min-h-[100dvh] bg-canvas text-text">
      {screen.kind === 'ready' && app ? (
        <Cabinet
          app={app}
          token={screen.token}
          state={screen.state}
          onState={(state) => setScreen((current) => (current.kind === 'ready' ? { ...current, state } : current))}
          onUnlinked={() => void openSession(app)}
        />
      ) : (
        <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pt-5 pb-10">
          {screen.kind === 'loading' ? <LoadingView /> : null}
          {screen.kind === 'outside' ? <OutsideView /> : null}
          {screen.kind === 'error' ? (
            <Panel className="mt-6">
              <p role="alert" className="text-[15px] text-text">
                {screen.message}
              </p>
              {app ? (
                <Button className="mt-3 w-full" onClick={() => void openSession(app)}>
                  {t('tg.retry')}
                </Button>
              ) : null}
            </Panel>
          ) : null}
          {screen.kind === 'onboarding' && app ? (
            <Onboarding
              app={app}
              firstName={screen.firstName}
              siteUrl={screen.siteUrl}
              onLinked={(token, state) => setScreen({ kind: 'ready', token, state })}
            />
          ) : null}
        </div>
      )}
    </main>
  );
}

function Cabinet({
  app,
  token,
  state,
  onState,
  onUnlinked,
}: {
  app: TelegramWebApp;
  token: string;
  state: MiniAppState;
  onState: (state: MiniAppState) => void;
  onUnlinked: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>(() => {
    const first = initialTab(app);
    return first === 'admin' && !state.user.isAdmin ? 'home' : first;
  });
  const [recurring, setRecurring] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  const notify = useCallback((tone: Toast['tone'], text: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), tone, text });
    toastTimer.current = window.setTimeout(() => setToast(null), tone === 'danger' ? 7000 : 5000);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  const refresh = useCallback(async () => {
    try {
      onStateRef.current(await miniAppApi.state(tokenRef.current));
    } catch {
      // покажем прежнее состояние; следующее действие обновит его
    }
  }, []);

  // Вернулись в кабинет (после оплаты криптой на сайте, из бота) — обновляем данные.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const goTo = useCallback(
    (next: TabId, options?: { recurring?: boolean }) => {
      if (options?.recurring !== undefined) setRecurring(options.recurring);
      haptic.select(app);
      setTab(next);
      window.scrollTo({ top: 0 });
    },
    [app],
  );

  const openSite = useCallback(
    async (path: string) => {
      try {
        const { url } = await miniAppApi.siteLogin(tokenRef.current, path);
        app.openLink(url);
      } catch {
        app.openLink(`${state.siteUrl}${path}`);
        notify('info', tRef.current('tg.siteLoginFallback'));
      }
    },
    [app, notify, state.siteUrl],
  );

  const context = useMemo<MiniApp>(
    () => ({ app, token, state, setState: onState, refresh, notify, goTo, openSite }),
    [app, token, state, onState, refresh, notify, goTo, openSite],
  );

  const tabs = TABS.filter((item) => item.id !== 'admin' || state.user.isAdmin);
  const info = subscriptionInfo(state);
  const name = state.user.name || (state.user.telegramUsername ? `@${state.user.telegramUsername}` : '');
  const titles: Record<TabId, string> = {
    home: name ? t('tg.hello', { name: name.split(' ')[0] ?? name }) : t('tg.tabHome'),
    plans: t('tg.plansTitle'),
    payments: t('tg.tabPayments'),
    profile: t('tg.tabProfile'),
    admin: t('tg.adminTitle'),
  };

  return (
    <MiniAppProvider value={context}>
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">
        <header className="flex items-center justify-between gap-3 pt-1">
          <h1 className="min-w-0 truncate text-[22px] font-semibold tracking-tight">{titles[tab]}</h1>
          <Badge tone={PLAN_TONE[info.plan] ?? 'neutral'}>
            {state.user.isVip ? 'VIP' : (state.plans.find((plan) => plan.id === info.plan)?.title ?? 'Free')}
          </Badge>
        </header>

        <div role="tabpanel" id={`tg-panel-${tab}`} aria-labelledby={`tg-tab-${tab}`}>
          {tab === 'home' ? <HomeTab /> : null}
          {tab === 'plans' ? <PlansTab recurring={recurring} onRecurringChange={setRecurring} /> : null}
          {tab === 'payments' ? <PaymentsTab /> : null}
          {tab === 'profile' ? <ProfileTab onUnlinked={onUnlinked} /> : null}
          {tab === 'admin' && state.user.isAdmin ? <AdminTab /> : null}
        </div>
      </div>

      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4">
          <div
            key={toast.id}
            role={toast.tone === 'danger' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex w-full max-w-md animate-slide-up items-start gap-2 rounded-xl border px-3.5 py-3 text-[14px] leading-5 shadow-lg',
              toast.tone === 'success' && 'border-accent/40 bg-surface text-text',
              toast.tone === 'info' && 'border-stroke-strong bg-surface text-text',
              toast.tone === 'danger' && 'border-danger/40 bg-surface text-danger',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'mt-1.5 size-2 shrink-0 rounded-full',
                toast.tone === 'success' ? 'bg-accent' : toast.tone === 'danger' ? 'bg-danger' : 'bg-muted',
              )}
            />
            <span className="flex-1">{toast.text}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label={t('tg.close')}
              className="-m-1 grid size-8 shrink-0 place-items-center rounded-full text-muted hover:text-text"
            >
              <CloseIcon className="size-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      <nav
        aria-label={t('tg.navLabel')}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-stroke bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        <div role="tablist" className="mx-auto grid max-w-md" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map((item) => {
            const Icon = item.icon;
            const active = item.id === tab;
            const count = item.id === 'admin' ? state.pendingRefunds : 0;
            return (
              <button
                key={item.id}
                id={`tg-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`tg-panel-${item.id}`}
                onClick={() => goTo(item.id)}
                className={cn(
                  'relative flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-150',
                  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                  active ? 'text-accent' : 'text-muted hover:text-text',
                )}
              >
                <span className="relative">
                  <Icon className={cn('size-[22px]', active && item.id === 'plans' && 'fill-accent/20')} />
                  {count > 0 ? (
                    <span className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-warning px-1 text-center text-[10px] leading-4 font-semibold text-canvas">
                      {count}
                    </span>
                  ) : null}
                </span>
                {t(item.label)}
              </button>
            );
          })}
        </div>
      </nav>
    </MiniAppProvider>
  );
}

function LoadingView() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-44 w-full" />
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    </div>
  );
}

function OutsideView() {
  const { t } = useTranslation();
  return (
    <Panel className="mt-10 flex flex-col items-center gap-3 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
        <TelegramIcon className="size-6" />
      </span>
      <h1 className="text-lg font-semibold">{t('tg.outsideTitle')}</h1>
      <p className="text-[14px] leading-6 text-muted">{t('tg.outsideText')}</p>
      <a href={BOT_URL} className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-md bg-action px-4 font-medium text-action-text">
        <TelegramIcon className="size-4" />
        {t('tg.openBot')}
      </a>
    </Panel>
  );
}
