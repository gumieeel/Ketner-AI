import { Link } from 'react-router-dom';
import { PlanCards } from '@/components/pricing/plan-cards';
import { useTranslation } from '@/i18n';
import { SectionHead } from './section-head';

export function LandingPricingSection() {
  const { t } = useTranslation();

  return (
    <section
      aria-labelledby="pricing-title"
      id="pricing"
      className="w-full scroll-mt-20 pt-28 md:pt-36"
    >
      <SectionHead
        id="pricing-title"
        title={t('home.pricingTitle')}
        lead={
          <>
            <p>{t('home.pricingLead')}</p>
            <Link
              to="/pricing"
              className="mt-3 inline-flex min-h-11 items-center text-[15px] font-medium text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
            >
              {t('home.pricingCompare')}
            </Link>
          </>
        }
      />
      <PlanCards variant="compact" className="mt-12" />
    </section>
  );
}
