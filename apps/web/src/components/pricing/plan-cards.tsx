import { Link } from 'react-router-dom';
import { CheckIcon } from '@/components/icons';
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

/**
 * Тарифы одной полосой: четыре ячейки с тонкими разделителями. Pro выделен тоном
 * поверхности и нефритовой вкладкой сверху, текущий тариф — рамкой акцента.
 */
export function PlanCards({ variant = 'compact', className }: PlanCardsProps) {
  const { t, language } = useTranslation();
  const user = useAuth((state) => state.user);
  const currentPlan = user?.plan ?? 'free';
  const isAuthenticated = Boolean(user);

  return (
    <div
      className={cn(
        'grid w-full grid-cols-1 gap-px overflow-hidden rounded-xl border border-stroke bg-stroke text-left md:grid-cols-2 xl:grid-cols-4',
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

        // На главной тарифы вложены в секцию с h2, на странице тарифов — сразу под h1.
        const PlanHeading = variant === 'compact' ? 'h3' : 'h2';

        const tabLabel = isCurrent
          ? t('pricing.currentPlan')
          : isPro
            ? t('pricing.popular')
            : isUltra && variant === 'full'
              ? t('pricing.allInclusive')
              : null;

        return (
          <div
            key={plan.id}
            className={cn(
              'relative flex flex-col justify-between px-6 pt-12 pb-6',
              !tabLabel && 'max-md:pt-7',
              isPro ? 'bg-surface-2' : 'bg-surface',
              isCurrent && 'shadow-[inset_0_0_0_1px_var(--accent)]',
            )}
          >
            {tabLabel ? (
              <span
                className={cn(
                  'absolute top-0 left-6 px-2.5 py-1 text-[12px] font-medium [border-radius:0_0_7px_7px] [corner-shape:round_round_bevel_bevel]',
                  isPro && !isCurrent
                    ? 'bg-brand-gradient text-accent-text'
                    : 'bg-surface-3 text-text',
                )}
              >
                {tabLabel}
              </span>
            ) : null}

            <div>
              <div className="flex items-baseline justify-between gap-3">
                <PlanHeading className="sharp text-[24px] font-medium tracking-[-0.02em] text-text">
                  {t(plan.nameKey)}
                </PlanHeading>
                {plan.limitBadge ? (
                  <span className="text-[13px] text-subtle">{plan.limitBadge[language]}</span>
                ) : null}
              </div>

              <div className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="sharp tabular text-[48px] leading-none font-medium tracking-[-0.04em] text-text">
                  {priceDisplay}
                </span>
                <span className="text-[14px] text-muted">/{t('pricing.month')}</span>
              </div>

              {plan.modelsHighlight ? (
                <p className="mt-4 min-h-[2.8em] text-[14px] leading-snug text-muted">
                  {typeof plan.modelsHighlight === 'string'
                    ? plan.modelsHighlight
                    : plan.modelsHighlight[language]}
                </p>
              ) : null}

              <ul className="mt-6 flex flex-col gap-2.5 border-t border-stroke pt-6 text-[14px]">
                {lines.map((item, index) => (
                  <li key={index} className="flex items-start gap-2.5">
                    <CheckIcon className="mt-0.5 size-4 shrink-0 text-accent" />
                    <span className="leading-relaxed text-text">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-8">
              {variant === 'full' ? (
                isCurrent ? (
                  <Button variant="outline" disabled fullWidth>
                    {t('pricing.currentPlan')}
                  </Button>
                ) : isFree ? (
                  <Link
                    to="/chat"
                    className={buttonClasses({ variant: 'outline', fullWidth: true })}
                  >
                    {t('landing.cta')}
                  </Link>
                ) : (
                  <Link
                    to={`/checkout/${plan.id}`}
                    className={buttonClasses({
                      variant: emphasised ? 'primary' : 'outline',
                      fullWidth: true,
                    })}
                  >
                    {t('pricing.choosePlan')}
                  </Link>
                )
              ) : (
                <Link
                  to={isFree ? '/chat' : `/checkout/${plan.id}`}
                  className={buttonClasses({
                    variant: isPro ? 'primary' : 'outline',
                    fullWidth: true,
                  })}
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
