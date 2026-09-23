import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EyeIcon, EyeOffIcon, GitHubIcon, GoogleIcon } from '@/components/icons';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { authClient } from '@/features/auth/auth-client';
import { useAuth } from '@/features/auth/auth-store';
import { useTranslation } from '@/i18n';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

/**
 * Страница регистрации.
 * Клиентская валидация, сохранение сессии и создание аккаунта.
 */
export function SignupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const status = useAuth((state) => state.status);
  const signup = useAuth((state) => state.signup);
  const mockOAuth = useAuth((state) => state.mockOAuth);

  useEffect(() => {
    if (status === 'authenticated') {
      navigate('/chat', { replace: true });
    }
  }, [status, navigate]);

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
      navigate('/chat', { replace: true });
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
        callbackURL: window.location.origin + '/chat',
      });
      if (res?.data?.url) {
        window.location.href = res.data.url;
        return;
      }
      if (res?.error) {
        await mockOAuth(provider);
        navigate('/chat', { replace: true });
        return;
      }
    } catch {
      try {
        await mockOAuth(provider);
        navigate('/chat', { replace: true });
      } catch (error) {
        setServerError(error instanceof Error ? error.message : 'Ошибка OAuth');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.signupTitle')}
      footer={
        <Link to="/login" className="text-accent hover:underline">
          {t('auth.toLogin')}
        </Link>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {serverError ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
          >
            {serverError}
          </div>
        ) : null}

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

        <Field id="signup-password" label={t('auth.password')} error={passwordError ?? undefined}>
          {({ id, invalid, 'aria-describedby': describedBy }) => (
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
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 flex size-8 items-center justify-center rounded-[6px] text-muted hover:text-text transition-colors"
                aria-label={showPassword ? 'Скрыть' : 'Показать'}
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOffIcon className="text-base" />
                ) : (
                  <EyeIcon className="text-base" />
                )}
              </button>
            </div>
          )}
        </Field>

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? t('auth.signingUp') : t('auth.signup')}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-stroke/20" />
        {t('auth.orDivider')}
        <span className="h-px flex-1 bg-stroke/20" />
      </div>

      <div className="flex flex-col gap-2">
        <Button
          variant="outline"
          className="w-full"
          disabled={loading}
          onClick={() => void handleOAuth('google')}
          title={t('auth.oauthStub')}
        >
          <GoogleIcon className="text-lg" />
          {t('auth.continueGoogle')}
        </Button>
        <Button
          variant="outline"
          className="w-full"
          disabled={loading}
          onClick={() => void handleOAuth('github')}
          title={t('auth.oauthStub')}
        >
          <GitHubIcon className="text-lg" />
          {t('auth.continueGitHub')}
        </Button>
      </div>

      <p role="status" className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
        {t('auth.demoNotice')}
      </p>
    </AuthShell>
  );
}
