import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n';

export function LandingPage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center">
      <img
        src="/logo-mark.png"
        alt="Ketner AI"
        className="size-24 object-contain drop-shadow-md md:size-28"
      />
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-4xl font-bold tracking-tight md:text-5xl">{t('landing.title')}</h1>
        <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">{t('landing.subtitle')}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <Link to="/chat">
          <Button size="lg">{t('landing.cta')}</Button>
        </Link>
        <Link to="/login">
          <Button size="lg" variant="outline">
            {t('nav.login')}
          </Button>
        </Link>
      </div>
    </div>
  );
}
