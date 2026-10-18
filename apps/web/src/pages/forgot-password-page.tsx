import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertIcon } from '@/components/icons';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { requestPasswordReset } from '@/features/auth/api';
import { clearPendingReset, savePendingCode } from '@/features/auth/pending-code';
import { useTranslation } from '@/i18n';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * «Забыли пароль?», шаг 1: почта аккаунта. Сервер присылает на неё код (если аккаунт есть), дальше —
 * ввод кода на /login/forgot/verify и новый пароль на /login/forgot/new.
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawRedirect = searchParams.get('redirect');
  const isSafeRedirect = Boolean(
    rawRedirect && rawRedirect.startsWith('/') && !rawRedirect.startsWith('//'),
  );
  const query = isSafeRedirect && rawRedirect ? `?redirect=${encodeURIComponent(rawRedirect)}` : '';

  const [email, setEmail] = useState(() => searchParams.get('email') || '');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loginParams = new URLSearchParams({
    ...(email.trim() ? { email: email.trim() } : {}),
    ...(isSafeRedirect && rawRedirect ? { redirect: rawRedirect } : {}),
  }).toString();
  const loginLink = loginParams ? `/login?${loginParams}` : '/login';

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !EMAIL_REGEX.test(trimmedEmail)) {
      setEmailError(t('auth.emailInvalid'));
      return;
    }
    setEmailError(null);

    setLoading(true);
    try {
      const challenge = await requestPasswordReset(trimmedEmail);
      clearPendingReset();
      savePendingCode('password-reset', {
        challengeId: challenge.challengeId,
        email: trimmedEmail,
        maskedEmail: challenge.maskedEmail,
        resendAt: Date.now() + challenge.resendAfterSec * 1000,
      });
      navigate(`/login/forgot/verify${query}`);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : t('auth.forgotFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.forgotTitle')}
      subtitle={t('auth.forgotSubtitle')}
      footer={
        <Link
          to={loginLink}
          className="inline-flex min-h-11 items-center font-medium text-accent hover:underline"
        >
          {t('auth.forgotBackToLogin')}
        </Link>
      }
    >
      <div className="flex flex-col gap-6">
        {serverError && (
          <div
            role="alert"
            className="flex items-center gap-2.5 rounded-xl border border-danger/30 bg-danger-soft p-3 text-[13px] leading-5 text-danger"
          >
            <AlertIcon className="size-4 shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          <Field id="forgot-email" label={t('auth.email')} error={emailError ?? undefined}>
            {({ id, invalid, 'aria-describedby': describedBy }) => (
              <Input
                id={id}
                invalid={invalid}
                aria-describedby={describedBy}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                autoFocus
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError(null);
                }}
                disabled={loading}
              />
            )}
          </Field>

          <Button size="lg" fullWidth loading={loading} type="submit" className="mt-2">
            {loading ? t('auth.forgotSending') : t('auth.forgotSubmit')}
          </Button>
        </form>
      </div>
    </AuthShell>
  );
}
