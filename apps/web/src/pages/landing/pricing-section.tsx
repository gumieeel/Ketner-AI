import { Link } from 'react-router-dom';
import { ArrowRightIcon } from '@/components/icons';
import { Section } from '@/components/marketing/section';
import { PlanCards } from '@/components/pricing/plan-cards';
import { useTranslation } from '@/i18n';

export function LandingPricingSection() {
  const { t } = useTranslation();

  return (
    <Section
      id="pricing"
      label={t('landing.pricingLabel')}
      title={t('landing.pricingTitle')}
      description={t('landing.pricingSubtitle')}
    >
      <div className="flex w-full flex-col items-center gap-8">
        <PlanCards variant="compact" />
        <Link
          to="/pricing"
          className="group inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-muted transition-colors duration-200 hover:bg-surface-2 hover:text-text"
        >
          <span>{t('landing.pricingCompare')}</span>
          <ArrowRightIcon className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      </div>
    </Section>
  );
}
