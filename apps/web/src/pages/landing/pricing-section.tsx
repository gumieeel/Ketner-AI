import { Link } from 'react-router-dom';
import { ArrowRightIcon } from '@/components/icons';
import { Section } from '@/components/marketing/section';
import { PlanCards } from '@/components/pricing/plan-cards';
import { useTranslation } from '@/i18n';

export function LandingPricingSection() {
  const { t, language } = useTranslation();

  return (
    <Section
      id="pricing"
      index="04"
      label={language === 'ru' ? 'Тарифы' : 'Pricing'}
      title={t('landing.pricingTitle')}
      description={t('landing.pricingSubtitle')}
    >
      <div className="flex flex-col items-center gap-8 w-full">
        <PlanCards variant="compact" />
        <Link
          to="/pricing"
          className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted hover:text-text transition-colors"
        >
          <span>
            {language === 'ru'
              ? 'Смотреть подробное сравнение тарифов'
              : 'View detailed plan comparison'}
          </span>
          <ArrowRightIcon className="size-3.5" />
        </Link>
      </div>
    </Section>
  );
}
