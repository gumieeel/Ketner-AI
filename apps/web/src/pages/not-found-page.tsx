import { Link } from 'react-router-dom';
import { ArrowRightIcon } from '@/components/icons';
import { buttonClasses } from '@/components/ui/button-classes';
import { useTranslation } from '@/i18n';
import { appHomePath, productSwitch } from '@/lib/product-switches';

/** Страница 404: крупный номер, пояснение и два пути назад. */
export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <div className="relative mx-auto my-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-2 py-16 text-center">
      <div
        aria-hidden="true"
        className="bg-aurora pointer-events-none absolute inset-x-[-10%] top-0 h-72 opacity-60 [mask-image:radial-gradient(ellipse_60%_70%_at_50%_30%,black,transparent)]"
      />

      <div className="relative z-10 flex flex-col items-center gap-4">
        <span
          aria-hidden="true"
          className="text-gradient animate-slide-up text-[96px] leading-none font-semibold tracking-tighter select-none md:text-[128px]"
        >
          404
        </span>

        <h1
          className="animate-slide-up text-xl font-semibold tracking-tight text-balance text-text md:text-2xl"
          style={{ animationDelay: '60ms' }}
        >
          {t('notFound.title')}
        </h1>

        <p
          className="animate-slide-up max-w-sm text-sm leading-6 text-muted"
          style={{ animationDelay: '100ms' }}
        >
          {t('notFound.text')}
        </p>

        <div
          className="animate-slide-up flex flex-wrap items-center justify-center gap-3 pt-4"
          style={{ animationDelay: '140ms' }}
        >
          <Link to="/" className={buttonClasses({ variant: 'primary', size: 'md' })}>
            {t('notFound.home')}
          </Link>
          <Link
            to={appHomePath()}
            className={buttonClasses({ variant: 'outline', size: 'md', className: 'gap-1.5' })}
          >
            {productSwitch('chat') ? t('notFound.openChat') : t('nav.solutions')}
            <ArrowRightIcon className="size-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
