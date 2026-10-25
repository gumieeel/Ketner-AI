import { Link } from 'react-router-dom';
import { ArrowRightIcon } from '@/components/icons';
import { HeroArc } from '@/components/marketing/hero-arc';
import { buttonClasses } from '@/components/ui/button-classes';
import { useTranslation } from '@/i18n';

/**
 * Финальный призыв: та же сцена, что и первый экран — графит, дуга и мятная кнопка.
 * Страница начинается и заканчивается одним и тем же жестом.
 */
export function LandingFinalCta() {
  const { t } = useTranslation();

  return (
    <section aria-labelledby="final-title" className="w-full pt-28 md:pt-36">
      <div className="hero-stage relative overflow-hidden rounded-[28px] px-6 py-16 sm:px-12 sm:py-24 lg:px-20 lg:py-28">
        <HeroArc className="opacity-80 max-md:opacity-30" />
        <div className="relative">
          <h2 id="final-title" className="t-headline max-w-[14ch] text-text">
            {t('home.finalTitle')}
          </h2>
          <p className="t-lead mt-6 max-w-[40ch]">{t('home.finalLead')}</p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/chat"
              className={buttonClasses({
                variant: 'primary',
                size: 'lg',
                className: 'group w-full sm:w-auto sm:min-w-[220px]',
              })}
            >
              {t('home.heroCta')}
              <ArrowRightIcon className="size-[18px] transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <Link
              to="/pricing"
              className={buttonClasses({
                variant: 'outline',
                size: 'lg',
                className: 'w-full sm:w-auto',
              })}
            >
              {t('home.heroSecondary')}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
