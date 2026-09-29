import { Link, useRouteError } from 'react-router-dom';
import { AlertIcon, RefreshIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { CornerMark } from '@/components/ui/corner-mark';
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
    <div className="relative mx-auto my-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center overflow-hidden rounded-lg border border-stroke bg-canvas py-16 px-6 text-center bg-grid hero-glow">
      <CornerMark size={12} className="absolute top-2 left-2 text-stroke-strong" />
      <CornerMark size={12} className="absolute top-2 right-2 text-stroke-strong rotate-90" />
      <CornerMark size={12} className="absolute bottom-2 right-2 text-stroke-strong rotate-180" />
      <CornerMark size={12} className="absolute bottom-2 left-2 text-stroke-strong -rotate-90" />

      <div className="relative z-10 flex flex-col items-center gap-4">
        <div className="grid size-14 place-items-center rounded-full border border-danger/30 bg-danger-soft text-danger">
          <AlertIcon className="size-7" />
        </div>

        <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-text">
          {t('error.title')}
        </h1>

        <p className="max-w-sm text-sm text-muted leading-relaxed">
          {t('error.text')}
        </p>

        {import.meta.env.DEV && errorMessage && (
          <pre className="max-w-md w-full overflow-x-auto rounded-md border border-stroke bg-surface-2 p-3 font-mono text-xs text-muted text-left">
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
          <Link to="/">
            <Button variant="outline" size="md">
              {t('notFound.home')}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
