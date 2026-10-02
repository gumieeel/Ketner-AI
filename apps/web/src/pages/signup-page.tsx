import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  GitHubIcon,
  GoogleIcon,
  SparkleIcon,
} from '@/components/icons';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Divider } from '@/components/ui/divider';
import { IconButton } from '@/components/ui/icon-button';
import { Field, Input } from '@/components/ui/input';
import { authClient } from '@/features/auth/auth-client';
import { useAuth } from '@/features/auth/auth-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

/**
 * Страница регистрации.
 * Клиентская валидация, индикатор требований пароля и сохранение сессии.
 */
export function SignupPage() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawRedirect = searchParams.get('redirect');
  const isSafeRedirect = Boolean(
    rawRedirect && rawRedirect.startsWith('/') && !rawRedirect.startsWith('//'),
  );
  const redirectUrl = isSafeRedirect && rawRedirect ? rawRedirect : '/chat';
  const status = useAuth((state) => state.status);
  const signup = useAuth((state) => state.signup);
  const mockOAuth = useAuth((state) => state.mockOAuth);

  useEffect(() => {
    if (status === 'authenticated') {
      navigate(redirectUrl, { replace: true });
    }
  }, [status, navigate, redirectUrl]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);

    let hasError = false;
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName) {
      setNameError(t('auth.nameRequired'));
      hasError = true;
    } else {
      setNameError(null);
    }

    if (!trimmedEmail || !EMAIL_REGEX.test(trimmedEmail)) {
      setEmailError(t('auth.emailInvalid'));
      hasError = true;
    } else {
      setEmailError(null);
    }

    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(t('auth.passwordTooShort'));
      hasError = true;
    } else {
      setPasswordError(null);
    }

    if (hasError) {
      return;
    }

    setLoading(true);
    try {
      await signup({ email: trimmedEmail, password, name: trimmedName });
      navigate(redirectUrl, { replace: true });
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Ошибка регистрации');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    setLoading(true);
    setServerError(null);
    try {
      const res = await authClient.signIn.social({
        provider,
        callbackURL: window.location.origin + redirectUrl,
      });
      if (res?.data?.url) {
        window.location.href = res.data.url;
        return;
      }
      if (res?.error) {
        if (import.meta.env.MODE === 'test') {
          await mockOAuth(provider);
          navigate(redirectUrl, { replace: true });
          return;
        }
        setServerError(res.error.message || `Ошибка авторизации через ${provider}`);
        return;
      }
    } catch (error) {
      if (import.meta.env.MODE === 'test') {
        try {
          await mockOAuth(provider);
          navigate(redirectUrl, { replace: true });
          return;
        } catch {
          // ignore
        }
      }
      setServerError(error instanceof Error ? error.message : 'Ошибка OAuth');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.signupTitle')}
      footer={
        <Link
          to={
            isSafeRedirect
              ? `/login?redirect=${encodeURIComponent(redirectUrl)}`
              : '/login'
          }
          className="text-accent hover:underline"
        >
          {t('auth.toLogin')}
        </Link>
      }
    >
      <div className="flex flex-col gap-6">
        {/* 1. Уведомление об оформлении checkout */}
        {redirectUrl.startsWith('/checkout') && (
          <div
            role="status"
            className="rounded-md border border-accent/30 bg-accent-soft p-3 text-[13px] text-text font-medium flex items-center gap-2.5"
          >
            <SparkleIcon className="size-4 shrink-0 text-accent" />
            <span>{t('auth.checkoutSignupNotice')}</span>
          </div>
        )}

        {/* 2. Серверная ошибка */}
        {serverError && (
          <div
            role="alert"
            className="flex flex-col gap-1 rounded-md border border-danger/30 bg-danger-soft p-3 text-[13px] text-danger"
          >
            <div className="flex items-center gap-2">
              <AlertIcon className="size-4 shrink-0" />
              <span>{serverError}</span>
            </div>
            {(serverError.toLowerCase().includes('уже существует') ||
              serverError.toLowerCase().includes('already exists')) && (
              <Link
                to={`/login?email=${encodeURIComponent(email.trim())}`}
                className="font-semibold underline hover:opacity-85 text-xs ml-6"
              >
                {language === 'ru'
                  ? 'Войти в существующий аккаунт →'
                  : 'Log into existing account →'}
              </Link>
            )}
          </div>
        )}

        {/* 3. OAuth Кнопки */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="outline"
            size="lg"
            fullWidth
            disabled={loading}
            onClick={() => void handleOAuth('google')}
            aria-label={t('auth.continueGoogle')}
            title={t('auth.oauthStub')}
            className="font-medium text-xs gap-2"
          >
            <GoogleIcon className="size-4 text-text shrink-0" />
            <span>Google</span>
          </Button>

          <Button
            variant="outline"
            size="lg"
            fullWidth
            disabled={loading}
            onClick={() => void handleOAuth('github')}
            aria-label={t('auth.continueGitHub')}
            title={t('auth.oauthStub')}
            className="font-medium text-xs gap-2"
          >
            <GitHubIcon className="size-4 text-text shrink-0" />
            <span>GitHub</span>
          </Button>
        </div>

        {/* 4. Разделитель */}
        <Divider variant="dashed" label={t('auth.orDivider')} className="my-1" />

        {/* 5. Форма: Имя, Email и Пароль */}
        <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          <Field id="signup-name" label={t('auth.name')} error={nameError ?? undefined}>
            {({ id, invalid, 'aria-describedby': describedBy }) => (
              <Input
                id={id}
                invalid={invalid}
                aria-describedby={describedBy}
                type="text"
                autoComplete="name"
                placeholder="Иван"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError(null);
                }}
                disabled={loading}
              />
            )}
          </Field>

          <Field id="signup-email" label={t('auth.email')} error={emailError ?? undefined}>
            {({ id, invalid, 'aria-describedby': describedBy }) => (
              <Input
                id={id}
                invalid={invalid}
                aria-describedby={describedBy}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError(null);
                }}
                disabled={loading}
              />
            )}
          </Field>

          <Field
            id="signup-password"
            label={t('auth.password')}
            error={passwordError ?? undefined}
          >
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
                    value={password}
                    className="pr-10"
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (passwordError) setPasswordError(null);
                    }}
                    disabled={loading}
                  />
                  <div className="absolute right-1 flex items-center">
                    <IconButton
                      size="sm"
                      label={
                        showPassword
                          ? language === 'ru'
                            ? 'Скрыть'
                            : 'Hide'
                          : language === 'ru'
                            ? 'Показать'
                            : 'Show'
                      }
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                    >
                      {showPassword ? (
                        <EyeOffIcon className="size-4" />
                      ) : (
                        <EyeIcon className="size-4" />
                      )}
                    </IconButton>
                  </div>
                </div>

                {/* Индикатор требований пароля */}
                <div className="flex items-center gap-1.5 text-xs pt-0.5">
                  <CheckIcon
                    className={cn(
                      'size-3.5',
                      password.length >= MIN_PASSWORD_LENGTH
                        ? 'text-success'
                        : 'text-subtle',
                    )}
                  />
                  <span
                    className={
                      password.length >= MIN_PASSWORD_LENGTH
                        ? 'text-muted'
                        : 'text-subtle'
                    }
                  >
                    {t('auth.passwordRequirement')}
                  </span>
                </div>
              </div>
            )}
          </Field>

          {/* 6. Кнопка «Зарегистрироваться» */}
          <Button
            size="lg"
            fullWidth
            loading={loading}
            type="submit"
            className="mt-2"
          >
            {loading ? t('auth.signingUp') : t('auth.signup')}
          </Button>
        </form>

        <p role="status" className="text-center font-mono text-[11px] text-muted">
          {t('auth.demoNotice')}
        </p>
      </div>
    </AuthShell>
  );
}
