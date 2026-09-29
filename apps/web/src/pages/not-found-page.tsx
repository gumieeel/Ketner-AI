import { Link } from 'react-router-dom';
import { ArrowRightIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { CornerMark } from '@/components/ui/corner-mark';
import { useTranslation } from '@/i18n';

export function NotFoundPage() {
  const { t, language } = useTranslation();

  return (
    <div className="relative mx-auto my-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center overflow-hidden rounded-lg border border-stroke bg-canvas py-16 px-6 text-center bg-grid hero-glow">
      <CornerMark size={12} className="absolute top-2 left-2 text-stroke-strong" />
      <CornerMark size={12} className="absolute top-2 right-2 text-stroke-strong rotate-90" />
      <CornerMark size={12} className="absolute bottom-2 right-2 text-stroke-strong rotate-180" />
      <CornerMark size={12} className="absolute bottom-2 left-2 text-stroke-strong -rotate-90" />

      <div className="relative z-10 flex flex-col items-center gap-4">
        <span className="font-mono text-7xl md:text-8xl font-bold tracking-tighter text-stroke-strong select-none">
          404
        </span>

        <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-text">
          {t('notFound.title')}
        </h1>

        <p className="max-w-sm text-sm text-muted leading-relaxed">
          {t('notFound.text')}
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
          <Link to="/">
            <Button variant="primary" size="md">
              {t('notFound.home')}
            </Button>
          </Link>
          <Link to="/chat">
            <Button
              variant="outline"
              size="md"
              rightIcon={<ArrowRightIcon className="size-3.5" />}
            >
              {language === 'ru' ? 'Открыть чат' : 'Open chat'}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
