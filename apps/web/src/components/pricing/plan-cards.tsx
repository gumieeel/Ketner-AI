import { Link } from 'react-router-dom';
import { BoltIcon, CheckIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/features/auth/auth-store';
import { PLANS, type Plan } from '@/features/billing/plans';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

export interface PlanCardsProps {
  variant?: 'compact' | 'full';
  className?: string;
}

export function PlanCards({ variant = 'compact', className }: PlanCardsProps) {
  const { t, language } = useTranslation();
  const user = useAuth((state) => state.user);
  const currentPlan = user?.plan ?? 'free';
  const isAuthenticated = Boolean(user);

  return (
    <div
      className={cn(
        'grid w-full grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 text-left items-stretch',
        className,
      )}
    >
      {PLANS.map((plan: Plan) => {
        const isPro = plan.id === 'pro';
        const isUltra = plan.id === 'ultra';
        const isFree = plan.id === 'free';
        const isCurrent = isAuthenticated && currentPlan === plan.id;

        const lines =
          variant === 'compact' && plan.highlights
            ? plan.highlights[language]
            : plan.bullets[language];

        const priceDisplay =
          language === 'ru'
            ? plan.priceMonthly === 0
              ? '0 ₽'
              : `${plan.priceMonthly.toLocaleString('ru-RU')} ₽`
            : plan.id === 'free'
              ? '$0'
              : plan.id === 'plus'
                ? '$9.99'
                : plan.id === 'pro'
                  ? '$19.99'
                  : '$39.99';

        return (
          <Card
            key={plan.id}
            className={cn(
              'relative flex flex-col justify-between p-6',
              isPro && 'gradient-border',
              isUltra && 'gradient-border gradient-border-animated',
              isCurrent && 'border-stroke-strong ring-1 ring-stroke-strong',
            )}
          >
            {isCurrent ? (
              <div className="absolute -top-3 left-6 z-10">
                <Badge tone="brand">{t('pricing.currentPlan')}</Badge>
              </div>
            ) : isPro ? (
              <div className="absolute -top-3 left-6 z-10">
                <Badge tone="brand">{t('pricing.popular')}</Badge>
              </div>
            ) : isUltra && variant === 'full' ? (
              <div className="absolute -top-3 left-6 z-10">
                <Badge tone="brand">{t('pricing.allInclusive')}</Badge>
              </div>
            ) : null}

            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <h2 className="text-base font-semibold text-text">
                  {t(plan.nameKey)}
                </h2>
                {plan.limitBadge && !isPro && (
                  <div className="flex items-center gap-1 font-mono text-[11px] text-muted">
                    <BoltIcon className="size-3 text-accent" />
                    <span>{plan.limitBadge[language]}</span>
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tabular text-text">
                  {priceDisplay}
                </span>
                <span className="font-mono text-xs text-muted">
                  /{t('pricing.month')}
                </span>
              </div>

              {plan.modelsHighlight && (
                <div className="mt-2 text-[11px] font-mono uppercase tracking-wider text-accent">
                  {typeof plan.modelsHighlight === 'string'
                    ? plan.modelsHighlight
                    : plan.modelsHighlight[language]}
                </div>
              )}

              <div className="my-5 h-px bg-stroke" />

              <ul className="flex flex-col gap-2.5 text-xs">
                {lines.map((item, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <CheckIcon className="size-4 shrink-0 text-accent mt-0.5" />
                    <span className="text-muted leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-8 pt-2">
              {variant === 'full' ? (
                isCurrent ? (
                  <Button
                    variant="outline"
                    disabled
                    fullWidth
                    className="font-medium text-xs opacity-70"
                  >
                    {t('pricing.currentPlan')}
                  </Button>
                ) : isFree ? (
                  <Link to="/chat" className="w-full block">
                    <Button
                      variant="outline"
                      fullWidth
                      className="font-medium text-xs"
                    >
                      {t('landing.cta')}
                    </Button>
                  </Link>
                ) : (
                  <Link to={`/checkout/${plan.id}`} className="w-full block">
                    <Button
                      variant={isPro || isUltra ? 'primary' : 'outline'}
                      fullWidth
                      className="font-medium text-xs"
                    >
                      {t('pricing.choosePlan')}
                    </Button>
                  </Link>
                )
              ) : (
                <Link
                  to={isFree ? '/chat' : `/checkout/${plan.id}`}
                  className="w-full block"
                >
                  <Button
                    variant={isPro || isUltra ? 'primary' : 'outline'}
                    fullWidth
                    className="font-medium text-xs"
                  >
                    {plan.id === 'free'
                      ? t('pricing.cta.free')
                      : plan.id === 'plus'
                        ? t('pricing.cta.plus')
                        : plan.id === 'pro'
                          ? t('pricing.cta.pro')
                          : t('pricing.cta.ultra')}
                  </Button>
                </Link>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
