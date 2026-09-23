import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GitHubIcon, GoogleIcon } from '@/components/icons';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/auth-store';
import { useTranslation } from '@/i18n';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

/**
 * Страница входа.
 * Полноценная клиентская валидация, сохранение сессии и поддержка mock-OAuth.
 */
export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const login = useAuth((state) => state.login);
  const mockOAuth = useAuth((state) => state.mockOAuth);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);

    let hasError = false;
    const trimmedEmail = email.trim();

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
      await login({ email: trimmedEmail, password });
      navigate('/');
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    setLoading(true);
    setServerError(null);
    try {
      await mockOAuth(provider);
      navigate('/');
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Ошибка OAuth');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoFill = () => {
    setEmail('demo@ketner.ai');
    setPassword('password123');
    setEmailError(null);
    setPasswordError(null);
    setServerError(null);
  };

  return (
    <AuthShell
      title={t('auth.loginTitle')}
      footer={
        <Link to="/signup" className="text-brand-600 hover:underline dark:text-brand-300">
          {t('auth.toSignup')}
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

        <Field id="login-email" label={t('auth.email')} error={emailError ?? undefined}>
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

        <Field id="login-password" label={t('auth.password')} error={passwordError ?? undefined}>
          {({ id, invalid, 'aria-describedby': describedBy }) => (
            <Input
              id={id}
              invalid={invalid}
              aria-describedby={describedBy}
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError(null);
              }}
              disabled={loading}
            />
          )}
        </Field>

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? t('auth.loggingIn') : t('auth.login')}
        </Button>

        <button
          type="button"
          onClick={handleDemoFill}
          className="text-left text-xs text-brand-600 hover:underline dark:text-brand-400"
        >
          {t('auth.demoQuickLogin')}
        </button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs text-zinc-400">
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
        {t('auth.orDivider')}
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
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
