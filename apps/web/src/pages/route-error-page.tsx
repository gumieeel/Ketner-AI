import { Link, useRouteError } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n';

/** Запасной экран на случай ошибки рендера или загрузки маршрута. */
export function RouteErrorPage() {
  const { t } = useTranslation();
  const error = useRouteError();

  // Ошибка уходит в консоль: позже это место станет точкой отправки в Sentry.
  console.error('[ketner] route error', error);

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold tracking-tight">{t('error.title')}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{t('error.text')}</p>
      <div className="flex gap-2">
        <Button onClick={() => window.location.reload()}>{t('error.reload')}</Button>
        <Link to="/">
          <Button variant="outline">{t('notFound.home')}</Button>
        </Link>
      </div>
    </div>
  );
}
