import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertIcon, CheckIcon } from '@/components/icons';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { CodeInput, type CodeInputStatus } from '@/components/auth/code-input';
import { Field } from '@/components/ui/input';
import { resendCode, verifyPasswordResetCode } from '@/features/auth/api';
import { useAuthNotice } from '@/features/auth/auth-notice';
import { useAuth } from '@/features/auth/auth-store';
import {
  clearPendingCode,
  readPendingCode,
  savePendingCode,
  savePendingReset,
  type PendingCode,
} from '@/features/auth/pending-code';
import type { CodeFlow } from '@/features/auth/types';
import { ApiError } from '@/features/chat/api';
import { useTranslation, type TranslationKey } from '@/i18n';
import { appHomePath } from '@/lib/product-switches';

const CODE_LENGTH = 6;

const FLOW_TEXT: Record<
  CodeFlow,
  { formPath: string; title: TranslationKey; subtitle: TranslationKey; restart: TranslationKey }
> = {
  signup: {
    formPath: '/signup',
    title: 'auth.verifyTitle',
    subtitle: 'auth.verifySubtitle',
    restart: 'auth.signup',
  },
  login: {
    formPath: '/login',
    title: 'auth.verifyLoginTitle',
    subtitle: 'auth.verifySubtitle',
    restart: 'auth.login',
  },
  'password-reset': {
    formPath: '/login/forgot',
    title: 'auth.resetVerifyTitle',
    subtitle: 'auth.resetVerifySubtitle',
    restart: 'auth.resetRequestCode',
  },
};

/**
 * Второй шаг входа, регистрации и восстановления пароля: 6-значный код, отправленный на почту.
 * Сессия (или, при сбросе пароля, переход к новому паролю) — только после верного кода; без начатой
 * заявки страница возвращает на форму.
 */
export function VerifyCodePage({ flow }: { flow: CodeFlow }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawRedirect = searchParams.get('redirect');
  const isSafeRedirect = Boolean(
    rawRedirect && rawRedirect.startsWith('/') && !rawRedirect.startsWith('//'),
  );
  const redirectUrl = isSafeRedirect && rawRedirect ? rawRedirect : appHomePath();
  const redirectQuery = isSafeRedirect ? `?redirect=${encodeURIComponent(redirectUrl)}` : '';
  const verifyCode = useAuth((state) => state.verifyCode);
  const showNotice = useAuthNotice((state) => state.show);
  const text = FLOW_TEXT[flow];
  const formPath = text.formPath;

  const [pending, setPending] = useState<PendingCode | null>(() => readPendingCode(flow));
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [codeStatus, setCodeStatus] = useState<CodeInputStatus>('idle');
  const [errorKey, setErrorKey] = useState(0);
  const [resending, setResending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const submitting = useRef(false);
  const resetTimer = useRef<number | undefined>(undefined);

  const resendIn = pending ? Math.max(0, Math.ceil((pending.resendAt - now) / 1000)) : 0;

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  if (!pending) {
    return <Navigate to={`${formPath}${redirectQuery}`} replace />;
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

  const fail = () => {
    setCodeStatus('error');
    setErrorKey((key) => key + 1);
  };

  const submit = async (value: string) => {
    if (submitting.current) return;
    if (value.length !== CODE_LENGTH) {
      setCodeError(t('auth.verifyCodeInvalid'));
      fail();
      return;
    }
    window.clearTimeout(resetTimer.current);
    submitting.current = true;
    setLoading(true);
    setCodeStatus('verifying');
    setServerError(null);
    setNotice(null);
    try {
      const payload = { challengeId: pending.challengeId, code: value };
      if (flow === 'password-reset') {
        const grant = await verifyPasswordResetCode(payload);
        savePendingReset({
          resetToken: grant.resetToken,
          email: pending.email,
          maskedEmail: grant.maskedEmail,
          expiresAt: Date.parse(grant.expiresAt),
        });
        clearPendingCode(flow);
      } else {
        await verifyCode(flow, payload);
        clearPendingCode(flow);
        showNotice(flow === 'signup' ? 'signed-up' : 'logged-in');
      }
      // Короткая вспышка клеток перед переходом: видно, что код принят.
      setCodeStatus('success');
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      navigate(flow === 'password-reset' ? `/login/forgot/new${redirectQuery}` : redirectUrl, {
        replace: true,
      });
    } catch (error) {
      handleError(error);
      fail();
      // Красные цифры видны, пока красное кольцо пробегает ряд справа налево (~500 мс), затем
      // клетки очищаются под новый ввод.
      resetTimer.current = window.setTimeout(() => {
        setCode('');
        setCodeStatus('idle');
      }, 600);
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
      title={t(text.title)}
      subtitle={t(text.subtitle, { email: pending.maskedEmail })}
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
                {t(text.restart)}
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
            {({ id, 'aria-describedby': describedBy }) => (
              <CodeInput
                id={id}
                aria-describedby={describedBy}
                length={CODE_LENGTH}
                value={code}
                status={codeStatus}
                errorKey={errorKey}
                autoFocus
                disabled={expired}
                readOnly={loading || codeStatus === 'success'}
                onChange={(digits) => {
                  window.clearTimeout(resetTimer.current);
                  setCode(digits);
                  if (codeError) setCodeError(null);
                  if (codeStatus === 'error') setCodeStatus('idle');
                }}
                // Код целиком (ввели или вставили) — подтверждаем сразу.
                onComplete={(digits) => {
                  if (!expired) void submit(digits);
                }}
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

export function VerifyPasswordResetPage() {
  return <VerifyCodePage flow="password-reset" />;
}
