import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CheckIcon, ExternalLinkIcon, MessagesIcon, StarIcon, TelegramIcon } from '@/components/icons';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import type { PlanId } from '@/features/billing/types';
import { ApiError, miniAppApi, type MiniAppPlan, type MiniAppState } from '@/features/telegram/api';
import { loadTelegramWebApp, type TelegramWebApp } from '@/features/telegram/webapp';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';

type Screen =
  | { kind: 'loading' }
  | { kind: 'outside' }
  | { kind: 'error'; message: string }
  | { kind: 'link'; firstName: string; siteUrl: string }
  | { kind: 'ready'; token: string; state: MiniAppState };

const DAY_MS = 24 * 3600 * 1000;
const BOT_URL = 'https://t.me/Robo_kassa_bot';
const SUPPORT_URL = 'https://t.me/ketner_support_bot';

const PLAN_TONE: Record<string, BadgeTone> = { free: 'neutral', plus: 'plus', pro: 'pro', ultra: 'ultra' };
const PLAN_HINT: Record<string, TranslationKey> = { plus: 'tg.planPlusHint', pro: 'tg.planProHint', ultra: 'tg.planUltraHint' };

/**
 * Кабинет Ketner AI внутри Telegram (мини-приложение бота): подписка, продление и смена тарифа
 * за звёзды, история оплат. Открывается кнопкой «Кабинет» в боте.
 */
export function TelegramAppPage() {
  const { t, language } = useTranslation();
  const setTheme = usePreferences((state) => state.setTheme);
  const setLanguage = usePreferences((state) => state.setLanguage);
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const appRef = useRef<TelegramWebApp | null>(null);
  // Язык переключается после запуска (по языку Telegram): текст ошибки берётся актуальный,
  // а сессия из-за смены языка заново не запрашивается.
  const tRef = useRef(t);
  tRef.current = t;
  const started = useRef(false);

  const openSession = useCallback(async (app: TelegramWebApp) => {
    try {
      const session = await miniAppApi.session(app.initData);
      if (session.linked) setScreen({ kind: 'ready', token: session.token, state: session });
      else setScreen({ kind: 'link', firstName: session.telegram.firstName, siteUrl: session.siteUrl });
    } catch (error) {
      setScreen({ kind: 'error', message: error instanceof ApiError ? error.message : tRef.current('tg.errorGeneric') });
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void loadTelegramWebApp().then((app) => {
      if (!app) {
        setScreen({ kind: 'outside' });
        return;
      }
      appRef.current = app;
      app.ready();
      app.expand();
      setTheme(app.colorScheme === 'light' ? 'light' : 'dark');
      const code = app.initDataUnsafe.user?.language_code ?? '';
      setLanguage(/^(ru|uk|be|kk)/.test(code) ? 'ru' : code ? 'en' : 'ru');
      void openSession(app);
    });
  }, [openSession, setLanguage, setTheme]);

  const app = appRef.current;

  return (
    <main className="min-h-[100dvh] bg-canvas text-text">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pt-5 pb-10">
        {screen.kind === 'loading' ? <LoadingView /> : null}
        {screen.kind === 'outside' ? <OutsideView /> : null}
        {screen.kind === 'error' ? (
          <Panel>
            <p role="alert" className="text-[15px] text-text">{screen.message}</p>
            {app ? (
              <Button className="mt-3 w-full" onClick={() => void openSession(app)}>
                {t('tg.retry')}
              </Button>
            ) : null}
          </Panel>
        ) : null}
        {screen.kind === 'link' && app ? (
          <LinkView
            app={app}
            firstName={screen.firstName}
            siteUrl={screen.siteUrl}
            onLinked={(token, state) => setScreen({ kind: 'ready', token, state })}
          />
        ) : null}
        {screen.kind === 'ready' && app ? (
          <Dashboard
            app={app}
            token={screen.token}
            state={screen.state}
            language={language}
            onState={(state) => setScreen({ kind: 'ready', token: screen.token, state })}
            onUnlinked={() => void openSession(app)}
          />
        ) : null}
      </div>
    </main>
  );
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('rounded-xl border border-stroke bg-surface p-4', className)}>{children}</section>;
}

function LoadingView() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-48 w-full" />
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

function LinkView({
  app,
  firstName,
  siteUrl,
  onLinked,
}: {
  app: TelegramWebApp;
  firstName: string;
  siteUrl: string;
  onLinked: (token: string, state: MiniAppState) => void;
}) {
  const { t } = useTranslation();
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await miniAppApi.link(app.initData, email.trim(), password);
      if (session.linked) {
        app.HapticFeedback?.notificationOccurred('success');
        onLinked(session.token, session);
      }
    } catch (caught) {
      app.HapticFeedback?.notificationOccurred('error');
      setError(caught instanceof ApiError ? caught.message : t('tg.errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="flex flex-col gap-1 pt-2">
        <h1 className="text-[22px] font-semibold tracking-tight">{t('tg.linkTitle', { name: firstName })}</h1>
        <p className="text-[14px] leading-6 text-muted">{t('tg.linkLead')}</p>
      </header>
      <Panel>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={emailId} className="text-[13px] font-medium">{t('tg.email')}</label>
            <Input id={emailId} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={passwordId} className="text-[13px] font-medium">{t('tg.password')}</label>
            <Input
              id={passwordId}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" loading={busy} className="w-full">
            {t('tg.linkSubmit')}
          </Button>
        </form>
      </Panel>
      <Panel className="flex flex-col gap-2">
        <p className="text-[14px] font-medium">{t('tg.linkOtherTitle')}</p>
        <p className="text-[13px] leading-5 text-muted">{t('tg.linkOtherText')}</p>
        <Button variant="outline" className="w-full gap-2" onClick={() => app.openLink(`${siteUrl}/settings#telegram`)}>
          {t('tg.linkViaSite')}
          <ExternalLinkIcon className="size-3.5" />
        </Button>
        <button
          type="button"
          onClick={() => app.openLink(`${siteUrl}/signup`)}
          className="min-h-10 text-[13px] text-accent hover:underline"
        >
          {t('tg.noAccount')}
        </button>
      </Panel>
    </>
  );
}

function formatDate(iso: string, language: string): string {
  return new Date(iso).toLocaleDateString(language === 'en' ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'long' });
}

function Dashboard({
  app,
  token,
  state,
  language,
  onState,
  onUnlinked,
}: {
  app: TelegramWebApp;
  token: string;
  state: MiniAppState;
  language: string;
  onState: (state: MiniAppState) => void;
  onUnlinked: () => void;
}) {
  const { t } = useTranslation();
  const [paying, setPaying] = useState<PlanId | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const { user, subscription, plans, rate, history, siteUrl } = state;
  const end = subscription.renewsAt ? Date.parse(subscription.renewsAt) : NaN;
  const running = user.isVip || (subscription.plan !== 'free' && Number.isFinite(end) && end > Date.now());
  const currentPlan: PlanId = user.isVip ? 'ultra' : running ? subscription.plan : 'free';
  const daysLeft = running && Number.isFinite(end) ? Math.max(1, Math.ceil((end - Date.now()) / DAY_MS)) : 0;

  const refresh = async () => onState(await miniAppApi.state(token));

  const waitForPayment = async (invoiceId: string) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { status } = await miniAppApi.invoiceStatus(token, invoiceId);
      if (status === 'paid') return true;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return false;
  };

  const pay = async (plan: MiniAppPlan) => {
    setPaying(plan.id);
    setNotice(null);
    try {
      const invoice = await miniAppApi.invoice(token, plan.id);
      app.openInvoice(invoice.link, (status) => {
        if (status === 'paid') {
          setNotice({ tone: 'success', text: t('tg.paymentProcessing') });
          void waitForPayment(invoice.invoiceId)
            .then(async (paid) => {
              await refresh();
              app.HapticFeedback?.notificationOccurred(paid ? 'success' : 'warning');
              setNotice({ tone: 'success', text: paid ? t('tg.paymentDone', { plan: plan.title }) : t('tg.paymentLate') });
            })
            .finally(() => setPaying(null));
          return;
        }
        if (status === 'failed') {
          app.HapticFeedback?.notificationOccurred('error');
          setNotice({ tone: 'danger', text: t('tg.paymentFailed') });
        }
        setPaying(null);
      });
    } catch (error) {
      setNotice({ tone: 'danger', text: error instanceof ApiError ? error.message : t('tg.errorGeneric') });
      setPaying(null);
    }
  };

  const unlink = async () => {
    await miniAppApi.unlink(token);
    onUnlinked();
  };

  return (
    <>
      <header className="flex items-center gap-3 pt-1">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-[17px] font-semibold text-accent">
          {(user.name || user.email).slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold">{user.name || user.email}</p>
          <p className="truncate text-[13px] text-muted">{user.email}</p>
        </div>
        <Badge tone={PLAN_TONE[currentPlan] ?? 'neutral'}>{currentPlan === 'free' ? 'Free' : plans.find((p) => p.id === currentPlan)?.title ?? currentPlan}</Badge>
      </header>

      <Panel>
        <p className="text-[13px] text-muted">{t('tg.subscription')}</p>
        {running ? (
          <>
            <p className="mt-1 text-[22px] font-semibold tracking-tight">
              {user.isVip ? 'Ultra · VIP' : plans.find((p) => p.id === currentPlan)?.title ?? currentPlan}
            </p>
            {user.isVip ? (
              <p className="mt-1 text-[14px] text-muted">{t('tg.vip')}</p>
            ) : (
              <>
                <p className="mt-1 text-[14px] text-muted">
                  {t(subscription.status === 'canceled' ? 'tg.untilCanceled' : 'tg.until', {
                    date: formatDate(subscription.renewsAt!, language),
                    days: daysLeft,
                  })}
                </p>
                <div
                  className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={30}
                  aria-valuenow={Math.min(30, daysLeft)}
                  aria-label={t('tg.daysLeft', { days: daysLeft })}
                >
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (daysLeft / 30) * 100)}%` }} />
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <p className="mt-1 text-[22px] font-semibold tracking-tight">Free</p>
            <p className="mt-1 text-[14px] text-muted">{t('tg.freeText')}</p>
          </>
        )}
      </Panel>

      {notice ? (
        <p
          role={notice.tone === 'danger' ? 'alert' : 'status'}
          className={cn(
            'rounded-lg border px-3 py-2.5 text-[14px]',
            notice.tone === 'success' ? 'border-accent/40 bg-accent-soft text-text' : 'border-danger/30 bg-danger-soft text-danger',
          )}
        >
          {notice.text}
        </p>
      ) : null}

      {!user.isVip ? (
        <section aria-labelledby="tg-plans" className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-2 px-1">
            <h2 id="tg-plans" className="text-[15px] font-semibold">
              {running ? t('tg.plansRenew') : t('tg.plansBuy')}
            </h2>
            <span className="text-[12px] text-subtle">{t('tg.perMonth')}</span>
          </div>
          {plans.map((plan) => {
            const isCurrent = running && plan.id === currentPlan;
            const starsLabel = plan.stars.toLocaleString(language === 'en' ? 'en-US' : 'ru-RU');
            return (
              <div
                key={plan.id}
                className={cn('flex flex-col gap-3 rounded-xl border bg-surface p-4', isCurrent ? 'border-accent/60' : 'border-stroke')}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[16px] font-semibold">
                      {plan.title}
                      {isCurrent ? (
                        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-accent">
                          <CheckIcon className="size-3.5" />
                          {t('tg.current')}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-[13px] leading-5 text-muted">{t(PLAN_HINT[plan.id] ?? 'tg.planPlusHint')}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="flex items-center justify-end gap-1 text-[17px] font-semibold tabular-nums">
                      {starsLabel}
                      <StarIcon className="size-4 fill-warning text-warning" />
                    </p>
                    <p className="text-[12px] text-subtle">≈ ${plan.priceUsd}</p>
                  </div>
                </div>
                <Button
                  variant={isCurrent || !running ? 'primary' : 'outline'}
                  className="w-full"
                  loading={paying === plan.id}
                  disabled={paying !== null}
                  onClick={() => void pay(plan)}
                >
                  {isCurrent
                    ? t('tg.renew', { stars: starsLabel })
                    : running
                      ? t('tg.switch', { plan: plan.title, stars: starsLabel })
                      : t('tg.buy', { stars: starsLabel })}
                </Button>
              </div>
            );
          })}
          <p className="px-1 text-[12px] leading-5 text-subtle">
            {running ? `${t('tg.renewHint')} ` : ''}
            {t('tg.rate', {
              rate: rate.usdPerStar.toFixed(4),
              source: rate.source === 'fragment' ? 'Fragment' : t('tg.rateDefault'),
            })}
          </p>
          <button
            type="button"
            onClick={() => app.openLink(`${siteUrl}/checkout/${running && currentPlan !== 'free' ? currentPlan : 'plus'}`)}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 text-[13px] text-accent hover:underline"
          >
            {t('tg.payCrypto')}
            <ExternalLinkIcon className="size-3.5" />
          </button>
        </section>
      ) : null}

      {history.length > 0 ? (
        <Panel>
          <h2 className="text-[15px] font-semibold">{t('tg.history')}</h2>
          <ul className="mt-2 divide-y divide-stroke">
            {history.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2.5 text-[14px]">
                <span className="min-w-0">
                  <span className="font-medium">{plans.find((p) => p.id === item.planId)?.title ?? item.planId}</span>
                  <span className="ml-2 text-[12px] text-subtle">{formatDate(item.paidAt, language)}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted">{item.amount}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel className="flex flex-col gap-2">
        <Button className="w-full gap-2" onClick={() => app.openLink(`${siteUrl}/chat`)}>
          <MessagesIcon className="size-4" />
          {t('tg.openChat')}
        </Button>
        <Button variant="outline" className="w-full gap-2" onClick={() => app.openTelegramLink(SUPPORT_URL)}>
          <TelegramIcon className="size-4" />
          {t('tg.support')}
        </Button>
        {confirmUnlink ? (
          <div className="flex flex-col gap-2 rounded-lg border border-stroke bg-canvas p-3">
            <p className="text-[13px] text-text">{t('tg.unlinkConfirm')}</p>
            <div className="flex gap-2">
              <Button variant="danger" size="sm" className="flex-1" onClick={() => void unlink()}>
                {t('tg.unlinkYes')}
              </Button>
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setConfirmUnlink(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmUnlink(true)} className="min-h-10 text-[13px] text-muted hover:text-text">
            {t('tg.unlink')}
          </button>
        )}
      </Panel>
    </>
  );
}
