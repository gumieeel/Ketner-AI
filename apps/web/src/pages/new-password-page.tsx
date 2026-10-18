import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertIcon, CheckIcon, EyeIcon, EyeOffIcon } from '@/components/icons';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Field, Input } from '@/components/ui/input';
import { useAuthNotice } from '@/features/auth/auth-notice';
import { useAuth } from '@/features/auth/auth-store';
import { clearPendingReset, readPendingReset } from '@/features/auth/pending-code';
import { ApiError } from '@/features/chat/api';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

const MIN_PASSWORD_LENGTH = 8;

/**
 * «Забыли пароль?», последний шаг: новый пароль после верного кода из письма. Сервер завершает
 * прежние сессии аккаунта и сразу открывает новую. Без принятого кода страница возвращает к началу.
 */
export function NewPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawRedirect = searchParams.get('redirect');
  const isSafeRedirect = Boolean(
    rawRedirect && rawRedirect.startsWith('/') && !rawRedirect.startsWith('//'),
  );
  const redirectUrl = isSafeRedirect && rawRedirect ? rawRedirect : '/chat';
  const completePasswordReset = useAuth((state) => state.completePasswordReset);
  const showNotice = useAuthNotice((state) => state.show);

  const [pending] = useState(() => readPendingReset());
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [repeatError, setRepeatError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(false);

  const restartParams = new URLSearchParams({
    ...(pending?.email ? { email: pending.email } : {}),
    ...(isSafeRedirect ? { redirect: redirectUrl } : {}),
  }).toString();
  const restartLink = restartParams ? `/login/forgot?${restartParams}` : '/login/forgot';

  if (!pending) {
    return <Navigate to={restartLink} replace />;
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);

    let hasError = false;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(t('auth.passwordTooShort'));
      hasError = true;
    } else {
      setPasswordError(null);
    }
    if (!hasError && repeat !== password) {
      setRepeatError(t('auth.passwordMismatch'));
      hasError = true;
    } else {
      setRepeatError(null);
    }
    if (hasError) return;

    setLoading(true);
    try {
      await completePasswordReset({ resetToken: pending.resetToken, password });
      clearPendingReset();
      showNotice('password-reset');
      navigate(redirectUrl, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'reset_expired') {
        clearPendingReset();
        setExpired(true);
      }
      setServerError(error instanceof Error ? error.message : t('auth.newPasswordFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.newPasswordTitle')}
      subtitle={t('auth.newPasswordSubtitle', { email: pending.maskedEmail })}
      footer={
        <Link
          to="/login"
          onClick={() => clearPendingReset()}
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
            className="flex flex-col gap-1 rounded-xl border border-danger/30 bg-danger-soft p-3 text-[13px] leading-5 text-danger"
          >
            <div className="flex items-center gap-2">
              <AlertIcon className="size-4 shrink-0" />
              <span>{serverError}</span>
            </div>
            {expired && (
              <Link
                to={restartLink}
                className="ml-6 inline-flex min-h-9 items-center text-xs font-semibold underline hover:opacity-85"
              >
                {t('auth.resetRequestCode')}
              </Link>
            )}
          </div>
        )}

        <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          {/* Подсказка менеджерам паролей: для какой учётной записи сохраняется новый пароль. */}
          <input
            type="email"
            name="email"
            autoComplete="username"
            value={pending.email}
            readOnly
            hidden
          />

          <Field id="new-password" label={t('auth.newPassword')} error={passwordError ?? undefined}>
            {({ id, invalid, 'aria-describedby': describedBy }) => (
              <div className="flex flex-col gap-2">
                <div className="relative flex items-center">
                  <Input
                    id={id}
                    invalid={invalid}
                    aria-describedby={describedBy}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    autoFocus
                    value={password}
                    className="pr-10"
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (passwordError) setPasswordError(null);
                    }}
                    disabled={loading || expired}
                  />
                  <div className="absolute right-1 flex items-center">
                    <IconButton
                      size="sm"
                      label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <EyeOffIcon className="size-4" />
                      ) : (
                        <EyeIcon className="size-4" />
                      )}
                    </IconButton>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 pt-0.5 text-xs">
                  <CheckIcon
                    className={cn(
                      'size-3.5',
                      password.length >= MIN_PASSWORD_LENGTH ? 'text-success' : 'text-subtle',
                    )}
                  />
                  <span
                    className={
                      password.length >= MIN_PASSWORD_LENGTH ? 'text-muted' : 'text-subtle'
                    }
                  >
                    {t('auth.passwordRequirement')}
                  </span>
                </div>
              </div>
            )}
          </Field>

          <Field
            id="new-password-repeat"
            label={t('auth.newPasswordRepeat')}
            error={repeatError ?? undefined}
          >
            {({ id, invalid, 'aria-describedby': describedBy }) => (
              <Input
                id={id}
                invalid={invalid}
                aria-describedby={describedBy}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="••••••••"
                value={repeat}
                onChange={(e) => {
                  setRepeat(e.target.value);
                  if (repeatError) setRepeatError(null);
                }}
                disabled={loading || expired}
              />
            )}
          </Field>

          <Button
            size="lg"
            fullWidth
            loading={loading}
            disabled={expired}
            type="submit"
            className="mt-2"
          >
            {loading ? t('auth.newPasswordSaving') : t('auth.newPasswordSubmit')}
          </Button>
        </form>
      </div>
    </AuthShell>
  );
}
