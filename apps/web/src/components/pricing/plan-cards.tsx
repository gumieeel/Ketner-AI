import { Link } from 'react-router-dom';
import { BoltIcon, CheckIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { useAuth } from '@/features/auth/auth-store';
import { PLANS, type Plan } from '@/features/billing/plans';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

export interface PlanCardsProps {
  variant?: 'compact' | 'full';
  className?: string;
}

/** Цвет «точки тарифа» рядом с названием: те же токены, что и у Badge тарифов. */
const TIER_DOT: Record<string, string> = {
  free: 'bg-subtle',
  plus: 'bg-tier-plus',
  pro: 'bg-tier-pro',
  ultra: 'bg-tier-ultra',
};

export function PlanCards({ variant = 'compact', className }: PlanCardsProps) {
  const { t, language } = useTranslation();
  const user = useAuth((state) => state.user);
  const currentPlan = user?.plan ?? 'free';
  const isAuthenticated = Boolean(user);

  return (
    <div
      className={cn(
        'grid w-full grid-cols-1 items-stretch gap-5 text-left md:grid-cols-2 xl:grid-cols-4',
        className,
      )}
    >
      {PLANS.map((plan: Plan) => {
        const isPro = plan.id === 'pro';
        const isUltra = plan.id === 'ultra';
        const isFree = plan.id === 'free';
        const isCurrent = isAuthenticated && currentPlan === plan.id;
        const emphasised = isPro || isUltra;

        const lines =
          variant === 'compact' && plan.highlights
            ? plan.highlights[language]
            : plan.bullets[language];

        const priceDisplay = plan.priceMonthly === 0 ? '$0' : `$${plan.priceMonthly}`;

        const compactCtaLabel =
          plan.id === 'free'
            ? t('pricing.cta.free')
            : plan.id === 'plus'
              ? t('pricing.cta.plus')
              : plan.id === 'pro'
                ? t('pricing.cta.pro')
                : t('pricing.cta.ultra');

        return (
          <div
            key={plan.id}
            className={cn(
              'relative flex flex-col justify-between rounded-lg border p-6 transition-[transform,box-shadow,border-color] duration-300 ease-out-expo',
              isPro
                ? 'gradient-border border-transparent bg-surface-2 shadow-highlight xl:-translate-y-2'
                : isUltra
                  ? 'gradient-border gradient-border-animated border-transparent bg-surface shadow-md'
                  : 'border-stroke bg-surface shadow-sm hover:border-stroke-strong hover:shadow-lg',
              isCurrent && 'ring-2 ring-accent/40',
            )}
          >
            {isCurrent ? (
              <div className="absolute -top-3 left-6 z-10">
                <Badge tone="brand" className="bg-surface">
                  {t('pricing.currentPlan')}
                </Badge>
              </div>
            ) : isPro ? (
              <div className="absolute -top-3 left-6 z-10">
                <span className="inline-flex items-center rounded-full bg-brand-gradient px-3 py-0.5 text-[12px] font-semibold leading-5 text-accent-text shadow-glow">
                  {t('pricing.popular')}
                </span>
              </div>
            ) : isUltra && variant === 'full' ? (
              <div className="absolute -top-3 left-6 z-10">
                <Badge tone="ultra" className="bg-surface">
                  {t('pricing.allInclusive')}
                </Badge>
              </div>
            ) : null}

            <div>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-text">
                  <span aria-hidden="true" className={cn('size-2 rounded-full', TIER_DOT[plan.id] ?? 'bg-subtle')} />
                  {t(plan.nameKey)}
                </h2>
                {plan.limitBadge && !isPro && (
                  <div className="flex items-center gap-1 text-xs font-medium text-muted">
                    <BoltIcon className="size-3.5 text-accent" />
                    <span>{plan.limitBadge[language]}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
                <span className="tabular text-4xl font-semibold tracking-tight text-text">{priceDisplay}</span>
                <span className="text-sm text-muted">/{t('pricing.month')}</span>
                {plan.originalPriceMonthly ? (
                  <span className="ml-1 text-sm font-normal text-subtle line-through">
                    ${plan.originalPriceMonthly}
                  </span>
                ) : null}
                {plan.discountBadge ? (
                  <Badge tone="warning" className="ml-1">
                    {plan.discountBadge[language]}
                  </Badge>
                ) : null}
              </div>

              {plan.modelsHighlight && (
                <div className="mt-3 text-[13px] font-medium leading-snug text-accent">
                  {typeof plan.modelsHighlight === 'string'
                    ? plan.modelsHighlight
                    : plan.modelsHighlight[language]}
                </div>
              )}

              <div className="my-5 h-px bg-stroke" />

              <ul className="flex flex-col gap-3 text-sm">
                {lines.map((item, index) => (
                  <li key={index} className="flex items-start gap-2.5">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                      <CheckIcon className="size-3.5" />
                    </span>
                    <span className="leading-relaxed text-muted">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-8 pt-2">
              {variant === 'full' ? (
                isCurrent ? (
                  <Button variant="outline" disabled fullWidth>
                    {t('pricing.currentPlan')}
                  </Button>
                ) : isFree ? (
                  <Link to="/chat" className={buttonClasses({ variant: 'outline', fullWidth: true })}>
                    {t('landing.cta')}
                  </Link>
                ) : (
                  <Link
                    to={`/checkout/${plan.id}`}
                    className={buttonClasses({ variant: emphasised ? 'primary' : 'outline', fullWidth: true })}
                  >
                    {t('pricing.choosePlan')}
                  </Link>
                )
              ) : (
                <Link
                  to={isFree ? '/chat' : `/checkout/${plan.id}`}
                  className={buttonClasses({ variant: emphasised ? 'primary' : 'outline', fullWidth: true })}
                >
                  {compactCtaLabel}
                </Link>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
