import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowLeftIcon, ExternalLinkIcon, LockIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Input } from '@/components/ui/input';
import { ApiError, miniAppApi, type MiniAppState } from '@/features/telegram/api';
import { haptic, type TelegramWebApp } from '@/features/telegram/webapp';
import { useTranslation } from '@/i18n';
import { Notice, Panel, Segmented } from './shared';

type Step = 'welcome' | 'existing';
type ExistingWay = 'password' | 'code';

/**
 * Первый запуск кабинета. Аккаунты в Telegram не создаются: регистрация — только на сайте.
 * Аккаунт подключается по коду из письма (почта → код → готово); пароль и код для сайта
 * остаются запасными способами.
 */
export function Onboarding({
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
  const [step, setStep] = useState<Step>('welcome');

  if (step === 'existing') {
    return (
      <ExistingAccount
        app={app}
        siteUrl={siteUrl}
        onBack={() => setStep('welcome')}
        onLinked={onLinked}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 pt-6">
      <div className="flex flex-col items-center gap-3 px-2 text-center">
        <img src="/logo-mark-160.png" alt="Ketner AI" className="size-16 object-contain" />
        <h1 className="text-[24px] font-semibold tracking-tight">
          {t('tg.welcomeTitle', { name: firstName })}
        </h1>
        <p className="text-[15px] leading-6 text-muted">{t('tg.welcomeLead')}</p>
      </div>

      <ul className="flex flex-col gap-2 rounded-xl border border-stroke bg-surface p-4 text-[14px] leading-5">
        {(['tg.welcomePoint1', 'tg.welcomePoint2', 'tg.welcomePoint3'] as const).map((key) => (
          <li key={key} className="flex gap-2.5">
            <span
              aria-hidden="true"
              className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent"
            />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>

      <EmailCodeFlow app={app} onLinked={onLinked} />

      <Button variant="outline" className="w-full" onClick={() => setStep('existing')}>
        {t('tg.otherWays')}
      </Button>

      <p className="px-2 text-center text-[13px] leading-5 text-muted">
        {t('tg.noAccount')}{' '}
        <button
          type="button"
          className="font-medium text-accent underline underline-offset-[3px]"
          onClick={() => app.openLink(`${siteUrl}/signup`)}
        >
          {t('tg.signupOnSite')}
        </button>
      </p>
    </div>
  );
}

/** Почта аккаунта → письмо с кодом → код в Telegram: аккаунт подключён. */
function EmailCodeFlow({
  app,
  onLinked,
}: {
  app: TelegramWebApp;
  onLinked: (token: string, state: MiniAppState) => void;
}) {
  const { t } = useTranslation();
  const emailId = useId();
  const codeId = useId();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sentTo || resendAt <= Date.now()) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [sentTo, resendAt]);

  const fail = (caught: unknown) => {
    haptic.error(app);
    setError(caught instanceof ApiError ? caught.message : t('tg.errorGeneric'));
  };

  const requestCode = async (address: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await miniAppApi.emailCode(app.initData, address);
      setSentTo(address);
      setCode('');
      setResendAt(Date.now() + result.resendAfterSec * 1000);
      setNow(Date.now());
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  const sendEmail = (event: FormEvent) => {
    event.preventDefault();
    void requestCode(email.trim());
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await miniAppApi.emailVerify(app.initData, code);
      if (session.linked) {
        haptic.success(app);
        onLinked(session.token, session);
        return;
      }
    } catch (caught) {
      fail(caught);
    }
    setBusy(false);
  };

  const waitSec = Math.max(0, Math.ceil((resendAt - now) / 1000));

  return (
    <Panel className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h2 className="text-[17px] font-semibold tracking-tight">{t('tg.linkTitle')}</h2>
        <p className="text-[14px] leading-5 text-muted">{t('tg.linkLead')}</p>
      </header>

      {sentTo === null ? (
        <form onSubmit={sendEmail} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={emailId} className="text-[13px] font-medium">
              {t('tg.email')}
            </label>
            <Input
              id={emailId}
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" size="lg" loading={busy} className="w-full">
            {t('tg.sendCode')}
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-3">
          <p className="text-[14px] leading-5" role="status">
            {t('tg.codeSentTo', { email: sentTo })}
          </p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={codeId} className="text-[13px] font-medium">
              {t('tg.emailCodeLabel')}
            </label>
            <Input
              id={codeId}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,11}"
              maxLength={11}
              required
              className="text-center font-mono text-[22px] tracking-[0.3em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
            />
          </div>
          <Button type="submit" size="lg" loading={busy} className="w-full">
            {t('tg.emailCodeSubmit')}
          </Button>
          <div className="flex items-center justify-between gap-2 text-[13px]">
            <button
              type="button"
              className="min-h-10 text-muted hover:text-text"
              disabled={busy}
              onClick={() => {
                setSentTo(null);
                setError(null);
              }}
            >
              {t('tg.changeEmail')}
            </button>
            <button
              type="button"
              className="min-h-10 font-medium text-accent disabled:text-subtle"
              disabled={busy || waitSec > 0}
              onClick={() => void requestCode(sentTo)}
            >
              {waitSec > 0 ? t('tg.resendIn', { sec: String(waitSec) }) : t('tg.resend')}
            </button>
          </div>
        </form>
      )}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Panel>
  );
}

function ExistingAccount({
  app,
  siteUrl,
  onBack,
  onLinked,
}: {
  app: TelegramWebApp;
  siteUrl: string;
  onBack: () => void;
  onLinked: (token: string, state: MiniAppState) => void;
}) {
  const { t } = useTranslation();
  const [way, setWay] = useState<ExistingWay>('password');

  return (
    <div className="flex flex-col gap-4 pt-2">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-10 items-center gap-1.5 self-start rounded-md px-1 text-[14px] text-muted hover:text-text"
      >
        <ArrowLeftIcon className="size-4" />
        {t('tg.back')}
      </button>
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-tight">{t('tg.existingTitle')}</h1>
        <p className="text-[14px] leading-6 text-muted">{t('tg.existingLead')}</p>
      </header>
      <Segmented
        label={t('tg.existingHow')}
        value={way}
        onChange={(value) => {
          haptic.select(app);
          setWay(value);
        }}
        options={[
          { value: 'password', label: t('tg.wayPassword') },
          { value: 'code', label: t('tg.wayCode') },
        ]}
      />
      {way === 'password' ? (
        <PasswordForm app={app} onLinked={onLinked} />
      ) : (
        <CodeFlow app={app} siteUrl={siteUrl} onLinked={onLinked} />
      )}
    </div>
  );
}

function PasswordForm({
  app,
  onLinked,
}: {
  app: TelegramWebApp;
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
        haptic.success(app);
        onLinked(session.token, session);
      }
    } catch (caught) {
      haptic.error(app);
      setError(caught instanceof ApiError ? caught.message : t('tg.errorGeneric'));
      setBusy(false);
    }
  };

  return (
    <Panel>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={emailId} className="text-[13px] font-medium">
            {t('tg.email')}
          </label>
          <Input
            id={emailId}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={passwordId} className="text-[13px] font-medium">
            {t('tg.password')}
          </label>
          <Input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button type="submit" loading={busy} className="w-full">
          {t('tg.linkSubmit')}
        </Button>
        <p className="flex items-start gap-2 text-[12px] leading-5 text-subtle">
          <LockIcon className="mt-0.5 size-3.5 shrink-0" />
          {t('tg.passwordSafe')}
        </p>
      </form>
    </Panel>
  );
}

/**
 * Код для ввода на сайте. Пока код на экране, кабинет сам проверяет, привязан ли Telegram,
 * и открывается, как только человек ввёл код в настройках.
 */
function CodeFlow({
  app,
  siteUrl,
  onLinked,
}: {
  app: TelegramWebApp;
  siteUrl: string;
  onLinked: (token: string, state: MiniAppState) => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const onLinkedRef = useRef(onLinked);
  onLinkedRef.current = onLinked;

  const issue = async () => {
    setBusy(true);
    setError(null);
    try {
      setCode(await miniAppApi.linkCode(app.initData));
      setNow(Date.now());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('tg.errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const expired = code ? code.expiresAt <= now : false;

  useEffect(() => {
    if (!code || expired) return;
    let stopped = false;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => {
      void miniAppApi
        .session(app.initData)
        .then((session) => {
          if (!stopped && session.linked) {
            stopped = true;
            haptic.success(app);
            onLinkedRef.current(session.token, session);
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => {
      stopped = true;
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
  }, [app, code, expired]);

  const left = code ? Math.max(0, Math.ceil((code.expiresAt - now) / 1000)) : 0;
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

  return (
    <Panel className="flex flex-col gap-3">
      <ol className="flex flex-col gap-2 text-[14px] leading-5">
        <li className="flex gap-2.5">
          <StepNumber n={1} />
          <span>{t('tg.codeStep1')}</span>
        </li>
        <li className="flex gap-2.5">
          <StepNumber n={2} />
          <span>{t('tg.codeStep2')}</span>
        </li>
        <li className="flex gap-2.5">
          <StepNumber n={3} />
          <span>{t('tg.codeStep3')}</span>
        </li>
      </ol>

      {code && !expired ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft px-3 py-4">
          <p className="text-[12px] font-medium uppercase tracking-wider text-muted">
            {t('tg.codeLabel')}
          </p>
          <div className="flex items-center gap-2">
            <span
              className="font-mono text-[30px] font-semibold tracking-[0.28em] text-text"
              aria-live="polite"
            >
              {code.code}
            </span>
            <CopyButton value={code.code} label={t('tg.codeCopy')} />
          </div>
          <p className="text-[12px] text-muted">{t('tg.codeExpires', { time: mmss })}</p>
          <p className="flex items-center gap-2 text-[12px] text-muted" role="status">
            <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-accent" />
            {t('tg.codeWaiting')}
          </p>
        </div>
      ) : (
        <Button className="w-full" loading={busy} onClick={() => void issue()}>
          {expired ? t('tg.codeRenew') : t('tg.codeGet')}
        </Button>
      )}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Button
        variant="outline"
        className="w-full gap-2"
        onClick={() => app.openLink(`${siteUrl}/settings#telegram`)}
      >
        {t('tg.openSettings')}
        <ExternalLinkIcon className="size-3.5" />
      </Button>
    </Panel>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-3 text-[12px] font-semibold tabular-nums text-text"
    >
      {n}
    </span>
  );
}
