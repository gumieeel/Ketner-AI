import { Link } from 'react-router-dom';
import { CheckIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/features/auth/auth-store';
import { PLANS } from '@/features/billing/plans';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

export function PricingPage() {
  const { t, language } = useTranslation();
  const user = useAuth((state) => state.user);
  const currentPlan = user?.plan ?? 'free';

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-12 md:px-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">{t('pricing.title')}</h1>
        <p className="max-w-2xl text-zinc-600 dark:text-zinc-300">{t('pricing.subtitle')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === currentPlan;

          return (
            <Card
              key={plan.id}
              className={cn(
                'flex flex-col',
                isCurrent ? 'border-accent ring-1 ring-accent/40' : plan.popular && 'border-accent',
              )}
            >
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">{t(plan.nameKey)}</h2>
                {isCurrent ? (
                  <Badge tone="brand">{t('pricing.currentPlan')}</Badge>
                ) : plan.popular ? (
                  <Badge tone="brand">{t('pricing.popular')}</Badge>
                ) : null}
              </div>

              <p className="mt-4 text-3xl font-semibold tracking-tight">
                ${plan.priceMonthly}
                <span className="ml-1 text-sm font-normal text-muted">{t('pricing.month')}</span>
              </p>

              <ul className="mt-5 flex flex-1 flex-col gap-2">
                {plan.bullets[language].map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2 text-sm text-text/80">
                    <CheckIcon className="mt-0.5 shrink-0 text-base text-accent" />
                    {bullet}
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                {isCurrent ? (
                  <Button variant="outline" disabled className="w-full opacity-70">
                    {t('pricing.currentPlanBadge')}
                  </Button>
                ) : plan.id === 'free' ? (
                  <Link to="/chat">
                    <Button variant="outline" className="w-full">
                      {t('landing.cta')}
                    </Button>
                  </Link>
                ) : (
                  <Link to={`/checkout/${plan.id}`}>
                    <Button variant={plan.popular ? 'primary' : 'outline'} className="w-full">
                      {t('pricing.choosePlan')}
                    </Button>
                  </Link>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">{t('pricing.notice')}</p>
    </div>
  );
}
