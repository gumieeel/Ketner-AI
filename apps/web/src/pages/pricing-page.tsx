import { Link } from 'react-router-dom';
import { CheckIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PLANS } from '@/features/billing/plans';
import { cn } from '@/lib/cn';
import { useTranslation } from '@/i18n';

export function PricingPage() {
  const { t, language } = useTranslation();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-12 md:px-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">{t('pricing.title')}</h1>
        <p className="max-w-2xl text-zinc-600 dark:text-zinc-300">{t('pricing.subtitle')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => (
          <Card
            key={plan.id}
            className={cn(
              'flex flex-col',
              plan.popular && 'border-brand-500 dark:border-brand-500',
            )}
          >
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{t(plan.nameKey)}</h2>
              {plan.popular ? <Badge tone="brand">{t('pricing.popular')}</Badge> : null}
            </div>

            <p className="mt-4 text-3xl font-semibold tracking-tight">
              ${plan.priceMonthly}
              <span className="ml-1 text-sm font-normal text-zinc-500 dark:text-zinc-400">
                {t('pricing.month')}
              </span>
            </p>

            <ul className="mt-5 flex flex-1 flex-col gap-2">
              {plan.bullets[language].map((bullet) => (
                <li
                  key={bullet}
                  className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-300"
                >
                  <CheckIcon className="mt-0.5 shrink-0 text-base text-brand-600 dark:text-brand-300" />
                  {bullet}
                </li>
              ))}
            </ul>

            <Link to={plan.id === 'free' ? '/chat' : `/checkout/${plan.id}`} className="mt-6">
              <Button variant={plan.popular ? 'primary' : 'outline'} className="w-full">
                {plan.id === 'free' ? t('landing.cta') : t('pricing.choosePlan')}
              </Button>
            </Link>
          </Card>
        ))}
      </div>

      <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">{t('pricing.notice')}</p>
    </div>
  );
}
