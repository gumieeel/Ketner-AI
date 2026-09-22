import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n';

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <p className="text-5xl font-semibold text-zinc-300 dark:text-zinc-600">404</p>
      <h1 className="text-xl font-semibold tracking-tight">{t('notFound.title')}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{t('notFound.text')}</p>
      <Link to="/">
        <Button variant="outline">{t('notFound.home')}</Button>
      </Link>
    </div>
  );
}
