import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GitHubIcon, GoogleIcon } from '@/components/icons';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useTranslation } from '@/i18n';

/**
 * Вход. Этап 1 — разметка и a11y-контракт формы.
 * Реальная логика (валидация, сессия, OAuth) появляется на этапе 3.
 */
export function LoginPage() {
  const { t } = useTranslation();
  const [submitted, setSubmitted] = useState(false);

  return (
    <AuthShell
      title={t('auth.loginTitle')}
      footer={
        <Link to="/signup" className="text-brand-600 hover:underline dark:text-brand-300">
          {t('auth.toSignup')}
        </Link>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
        }}
      >
        <Field id="login-email" label={t('auth.email')}>
          {({ id, invalid, 'aria-describedby': describedBy }) => (
            <Input
              id={id}
              invalid={invalid}
              aria-describedby={describedBy}
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
            />
          )}
        </Field>

        <Field id="login-password" label={t('auth.password')}>
          {({ id, invalid, 'aria-describedby': describedBy }) => (
            <Input
              id={id}
              invalid={invalid}
              aria-describedby={describedBy}
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
            />
          )}
        </Field>

        <Button type="submit" className="w-full">
          {t('auth.login')}
        </Button>
      </form>

      {submitted ? (
        <p role="status" className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
          {t('auth.demoNotice')}
        </p>
      ) : null}

      <div className="my-5 flex items-center gap-3 text-xs text-zinc-400">
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
        {t('auth.orDivider')}
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
      </div>

      <div className="flex flex-col gap-2">
        <Button
          variant="outline"
          className="w-full"
          aria-disabled="true"
          title={t('auth.oauthStub')}
        >
          <GoogleIcon className="text-lg" />
          {t('auth.continueGoogle')}
        </Button>
        <Button
          variant="outline"
          className="w-full"
          aria-disabled="true"
          title={t('auth.oauthStub')}
        >
          <GitHubIcon className="text-lg" />
          {t('auth.continueGitHub')}
        </Button>
      </div>
    </AuthShell>
  );
}
