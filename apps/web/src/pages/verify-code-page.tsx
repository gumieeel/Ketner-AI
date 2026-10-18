import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertIcon, CheckIcon } from '@/components/icons';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { resendCode } from '@/features/auth/api';
import { useAuthNotice } from '@/features/auth/auth-notice';
import { useAuth } from '@/features/auth/auth-store';
import {
  clearPendingCode,
  readPendingCode,
  savePendingCode,
  type PendingCode,
} from '@/features/auth/pending-code';
import type { AuthFlow } from '@/features/auth/types';
import { ApiError } from '@/features/chat/api';
import { useTranslation } from '@/i18n';

const CODE_LENGTH = 6;

/**
 * Второй шаг входа и регистрации: 6-значный код, отправленный на почту. Сессия появляется только
 * после верного кода; без начатого входа (регистрации) страница возвращает на форму.
 */
export function VerifyCodePage({ flow }: { flow: AuthFlow }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawRedirect = searchParams.get('redirect');
  const isSafeRedirect = Boolean(
    rawRedirect && rawRedirect.startsWith('/') && !rawRedirect.startsWith('//'),
  );
  const redirectUrl = isSafeRedirect && rawRedirect ? rawRedirect : '/chat';
  const verifyCode = useAuth((state) => state.verifyCode);
  const showNotice = useAuthNotice((state) => state.show);
  const formPath = flow === 'signup' ? '/signup' : '/login';

  const [pending, setPending] = useState<PendingCode | null>(() => readPendingCode(flow));
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
    const query = isSafeRedirect ? `?redirect=${encodeURIComponent(redirectUrl)}` : '';
    return <Navigate to={`${formPath}${query}`} replace />;
  }

  const formLink = `${formPath}?${new URLSearchParams({
    ...(pending.email ? { email: pending.email } : {}),
    ...(isSafeRedirect ? { redirect: redirectUrl } : {}),
  }).toString()}`;

  const handleError = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'challenge_expired') {
      clearPendingCode(flow);
      setExpired(true);
    }
    setServerError(error instanceof Error ? error.message : t('auth.verifyFailed'));
  };

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
      await verifyCode(flow, { challengeId: pending.challengeId, code: value });
      clearPendingCode(flow);
      showNotice(flow === 'signup' ? 'signed-up' : 'logged-in');
      navigate(redirectUrl, { replace: true });
    } catch (error) {
      handleError(error);
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
      const result = await resendCode(flow, pending.challengeId);
      const next = {
        ...pending,
        maskedEmail: result.maskedEmail,
        resendAt: Date.now() + result.resendAfterSec * 1000,
      };
      savePendingCode(flow, next);
      setPending(next);
      setNow(Date.now());
      setCode('');
      setNotice(t('auth.verifyResent'));
    } catch (error) {
      handleError(error);
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthShell
      title={flow === 'signup' ? t('auth.verifyTitle') : t('auth.verifyLoginTitle')}
      subtitle={t('auth.verifySubtitle', { email: pending.maskedEmail })}
      footer={
        <Link
          to={formLink}
          onClick={() => clearPendingCode(flow)}
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
                to={formLink}
                className="ml-6 inline-flex min-h-9 items-center text-xs font-semibold underline hover:opacity-85"
              >
                {flow === 'signup' ? t('auth.signup') : t('auth.login')}
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

export function VerifySignupPage() {
  return <VerifyCodePage flow="signup" />;
}

export function VerifyLoginPage() {
  return <VerifyCodePage flow="login" />;
}
