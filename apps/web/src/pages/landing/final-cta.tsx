import { Link } from 'react-router-dom';
import { KnotRelief } from '@/components/marketing/knot-relief';
import { buttonClasses } from '@/components/ui/button-classes';
import { useTranslation } from '@/i18n';

/**
 * Финальный призыв: нефритовая панель с тёмным текстом. Рельеф щита перекрашен
 * локальными переменными в тон панели.
 */
export function LandingFinalCta() {
  const { t } = useTranslation();

  return (
    <section aria-labelledby="final-title" className="w-full pt-28 md:pt-36">
      <div className="notch-br relative isolate overflow-hidden rounded-2xl bg-brand-gradient px-6 py-14 text-accent-text [--notch:48px] [--relief-edge:rgba(15,26,22,0.25)] [--relief-side-a:#5fc9a2] [--relief-side-b:#7ad9b6] [--relief-top-a:#b8f6df] [--relief-top-b:#a3eccf] sm:px-12 sm:py-20 lg:[--notch:72px]">
        <KnotRelief className="absolute -right-24 -bottom-48 -z-10 w-[520px] max-w-none opacity-90 max-md:hidden lg:-right-10 lg:w-[620px]" />
        <h2 id="final-title" className="t-headline max-w-[14ch] text-accent-text">
          {t('home.finalTitle')}
        </h2>
        <p className="mt-5 max-w-[46ch] text-[17px] leading-relaxed text-accent-text/80">{t('home.finalLead')}</p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link
            to="/chat"
            className={buttonClasses({ variant: 'ink', size: 'lg', className: 'w-full sm:w-auto sm:min-w-[200px]' })}
          >
            {t('home.heroCta')}
          </Link>
          <Link
            to="/pricing"
            className={buttonClasses({
              variant: 'outline',
              size: 'lg',
              className: 'w-full border-[#0f1a16]/30 text-accent-text hover:border-[#0f1a16]/60 hover:bg-[#0f1a16]/5 sm:w-auto',
            })}
          >
            {t('home.heroSecondary')}
          </Link>
        </div>
      </div>
    </section>
  );
}
