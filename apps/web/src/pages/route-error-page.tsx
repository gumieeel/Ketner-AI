import { Link, useRouteError } from 'react-router-dom';
import { AlertIcon, RefreshIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { useTranslation } from '@/i18n';

/** Запасной экран на случай ошибки рендера или загрузки маршрута. */
export function RouteErrorPage() {
  const { t } = useTranslation();
  const error = useRouteError();

  // Ошибка уходит в консоль: позже это место станет точкой отправки в Sentry.
  console.error('[ketner] route error', error);

  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : null;

  return (
    <div className="relative mx-auto my-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-2 py-16 text-center">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-[-10%] top-0 h-72 bg-[radial-gradient(ellipse_50%_60%_at_50%_30%,var(--danger-soft),transparent)]"
      />

      <div className="relative z-10 flex flex-col items-center gap-4">
        <div className="animate-scale-in grid size-16 place-items-center rounded-2xl border border-danger/30 bg-danger-soft text-danger shadow-lg">
          <AlertIcon className="size-8" />
        </div>

        <h1 className="animate-slide-up text-xl font-semibold tracking-tight text-balance text-text md:text-2xl">
          {t('error.title')}
        </h1>

        <p className="animate-slide-up max-w-sm text-sm leading-6 text-muted" style={{ animationDelay: '60ms' }}>
          {t('error.text')}
        </p>

        {import.meta.env.DEV && errorMessage && (
          <pre className="w-full max-w-md overflow-x-auto rounded-xl border border-stroke bg-surface-2 p-3 text-left font-mono text-xs text-muted">
            {errorMessage}
          </pre>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
          <Button
            variant="primary"
            size="md"
            leftIcon={<RefreshIcon className="size-3.5" />}
            onClick={() => window.location.reload()}
          >
            {t('error.reload')}
          </Button>
          <Link to="/" className={buttonClasses({ variant: 'outline', size: 'md' })}>
            {t('notFound.home')}
          </Link>
        </div>
      </div>
    </div>
  );
}
