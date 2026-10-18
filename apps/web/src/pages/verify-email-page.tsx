import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertIcon, CheckIcon } from '@/components/icons';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { resendSignupCode } from '@/features/auth/api';
import { useAuth } from '@/features/auth/auth-store';
import {
  clearPendingSignup,
  readPendingSignup,
  savePendingSignup,
  type PendingSignup,
} from '@/features/auth/pending-signup';
import { ApiError } from '@/features/chat/api';
import { useTranslation } from '@/i18n';

const CODE_LENGTH = 6;

/**
 * Второй шаг регистрации: ввод 6-значного кода, отправленного на почту.
 * Аккаунт создаётся только после верного кода; без незавершённой регистрации страница
 * возвращает на форму.
 */
export function VerifyEmailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const rawRedirect = searchParams.get('redirect');
  const isSafeRedirect = Boolean(
    rawRedirect && rawRedirect.startsWith('/') && !rawRedirect.startsWith('//'),
  );
  const redirectUrl = isSafeRedirect && rawRedirect ? rawRedirect : '/chat';
  const redirectQuery = isSafeRedirect ? `redirect=${encodeURIComponent(redirectUrl)}` : '';
  const password = (location.state as { password?: string } | null)?.password;
  const verifySignup = useAuth((state) => state.verifySignup);

  const [pending, setPending] = useState<PendingSignup | null>(() => readPendingSignup());
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const submitting = useRef(false);

  const resendIn = pending ? Math.max(0, Math.ceil((pending.resendAt - now) / 1000)) : 0;

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  if (!pending) {
    return <Navigate to={`/signup${redirectQuery ? `?${redirectQuery}` : ''}`} replace />;
  }

  const signupLink = `/signup?${new URLSearchParams({
    email: pending.email,
    ...(isSafeRedirect ? { redirect: redirectUrl } : {}),
  }).toString()}`;

  const submit = async (value: string) => {
    if (submitting.current) return;
    if (value.length !== CODE_LENGTH) {
      setCodeError(t('auth.verifyCodeInvalid'));
      return;
    }
    submitting.current = true;
    setLoading(true);
    setServerError(null);
    setNotice(null);
    try {
      await verifySignup({
        signupId: pending.signupId,
        code: value,
        email: pending.email,
        password,
      });
      clearPendingSignup();
      navigate(redirectUrl, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'signup_expired') {
        clearPendingSignup();
        setExpired(true);
      }
      setServerError(error instanceof Error ? error.message : t('auth.verifyFailed'));
      setCode('');
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  const resend = async () => {
    setResending(true);
    setServerError(null);
    setNotice(null);
    try {
      const result = await resendSignupCode(pending.signupId);
      const next = { ...pending, resendAt: Date.now() + result.resendAfterSec * 1000 };
      savePendingSignup(next);
      setPending(next);
      setNow(Date.now());
      setCode('');
      setNotice(t('auth.verifyResent'));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'signup_expired') {
        clearPendingSignup();
        setExpired(true);
      }
      setServerError(error instanceof Error ? error.message : t('auth.verifyFailed'));
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.verifyTitle')}
      subtitle={t('auth.verifySubtitle', { email: pending.email })}
      footer={
        <Link
          to={signupLink}
          onClick={() => clearPendingSignup()}
          className="inline-flex min-h-11 items-center font-medium text-accent hover:underline"
        >
          {t('auth.verifyChangeEmail')}
        </Link>
      }
    >
      <div className="flex flex-col gap-6">
        {serverError && (
          <div
            role="alert"
            className="flex flex-col gap-1 rounded-xl border border-danger/30 bg-danger-soft p-3 text-[13px] leading-5 text-danger"
          >
            <div className="flex items-center gap-2">
              <AlertIcon className="size-4 shrink-0" />
              <span>{serverError}</span>
            </div>
            {expired && (
              <Link
                to={signupLink}
                className="ml-6 inline-flex min-h-9 items-center text-xs font-semibold underline hover:opacity-85"
              >
                {t('auth.signup')}
              </Link>
            )}
          </div>
        )}

        {notice && (
          <div
            role="status"
            className="flex items-center gap-2.5 rounded-xl border border-accent/30 bg-accent-soft p-3 text-[13px] font-medium leading-5 text-text"
          >
            <CheckIcon className="size-4 shrink-0 text-accent" />
            <span>{notice}</span>
          </div>
        )}

        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit(code);
          }}
        >
          <Field id="verify-code" label={t('auth.verifyCode')} error={codeError ?? undefined}>
            {({ id, invalid, 'aria-describedby': describedBy }) => (
              <Input
                id={id}
                invalid={invalid}
                aria-describedby={describedBy}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={CODE_LENGTH}
                placeholder="000000"
                value={code}
                className="text-center font-mono text-2xl tracking-[0.5em] md:text-2xl"
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH);
                  setCode(digits);
                  if (codeError) setCodeError(null);
                  // Код целиком (ввели или вставили) — подтверждаем сразу.
                  if (digits.length === CODE_LENGTH && !expired) void submit(digits);
                }}
                disabled={loading || expired}
              />
            )}
          </Field>

          <Button
            size="lg"
            fullWidth
            loading={loading}
            type="submit"
            disabled={expired}
            className="mt-2"
          >
            {loading ? t('auth.verifying') : t('auth.verifySubmit')}
          </Button>
        </form>

        <div className="flex flex-col items-center gap-2 text-center">
          <Button
            variant="ghost"
            size="md"
            disabled={resendIn > 0 || resending || expired}
            loading={resending}
            onClick={() => void resend()}
          >
            {resendIn > 0
              ? t('auth.verifyResendIn', { seconds: resendIn })
              : t('auth.verifyResend')}
          </Button>
          <p className="text-xs leading-5 text-muted">{t('auth.verifyHint')}</p>
        </div>
      </div>
    </AuthShell>
  );
}
