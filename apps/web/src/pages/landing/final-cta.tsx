import { Link } from 'react-router-dom';
import { ArrowRightIcon } from '@/components/icons';
import { buttonClasses } from '@/components/ui/button-classes';
import { Reveal } from '@/components/ui/reveal';
import { useTranslation } from '@/i18n';

export function LandingFinalCta() {
  const { t } = useTranslation();

  return (
    <div className="my-8 w-full">
      <Reveal>
        <div className="gradient-border relative overflow-hidden rounded-xl bg-surface px-6 py-16 text-center shadow-lg md:px-12 md:py-24">
          {/* Аврора и сетка внутри панели */}
          <div aria-hidden="true" className="bg-aurora pointer-events-none absolute inset-0 opacity-90" />
          <div
            aria-hidden="true"
            className="bg-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_70%_80%_at_50%_50%,#000,transparent_80%)]"
          />

          <div className="relative z-10 mx-auto flex max-w-[640px] flex-col items-center gap-6">
            <img src="/logo-mark-160.png" alt="" className="size-14 object-contain drop-shadow-[0_8px_24px_rgba(46,230,166,0.35)]" />
            <h2 className="t-headline text-text">{t('landing.finalTitle')}</h2>
            <p className="max-w-[48ch] text-base leading-relaxed text-muted md:text-[17px]">
              {t('landing.finalLead')}
            </p>
            <div className="flex w-full flex-col gap-3 pt-2 sm:w-auto sm:flex-row">
              <Link
                to="/chat"
                className={buttonClasses({ variant: 'primary', size: 'lg', className: 'w-full sm:w-auto' })}
              >
                {t('landing.cta')}
                <ArrowRightIcon className="text-base" />
              </Link>
              <Link
                to="/pricing"
                className={buttonClasses({ variant: 'outline', size: 'lg', className: 'w-full sm:w-auto' })}
              >
                {t('landing.viewPlans')}
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
