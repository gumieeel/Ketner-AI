import { CheckIcon, LockIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import type { Plan, PremiumPack } from '@/features/billing/types';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

const PLAN_ACCENTS: Record<string, { card: string; bar: string }> = {
  ultra: { card: 'border-tier-ultra/40 ring-1 ring-tier-ultra/20', bar: 'bg-tier-ultra' },
  pro: { card: 'border-tier-pro/40 ring-1 ring-tier-pro/20', bar: 'bg-tier-pro' },
  plus: { card: 'border-tier-plus/40 ring-1 ring-tier-plus/15', bar: 'bg-tier-plus' },
};

const PERKS = ['checkout.perk1', 'checkout.perk2', 'checkout.perk3'] as const;

/** Сводка заказа справа: тариф, цена, что входит и строка о безопасности. */
export function OrderSummary({ plan, feeUsd = 0 }: { plan: Plan; feeUsd?: number }) {
  const { t, language } = useTranslation();
  const accent = PLAN_ACCENTS[plan.id] ?? { card: 'border-stroke', bar: 'bg-brand-gradient' };
  const highlight =
    typeof plan.modelsHighlight === 'string'
      ? plan.modelsHighlight
      : plan.modelsHighlight?.[language];

  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
      <Card
        className={cn('flex flex-col gap-5 overflow-hidden rounded-2xl p-5 sm:p-6', accent.card)}
      >
        <div aria-hidden="true" className={cn('absolute inset-x-0 top-0 h-1', accent.bar)} />

        <div className="flex items-center justify-between gap-3 border-b border-stroke pb-4">
          <span className="text-[13px] font-medium text-muted">{t('checkout.selectedPlan')}</span>
          <Badge tone="brand">{t('checkout.days30')}</Badge>
        </div>

        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-2xl font-semibold tracking-tight text-text">{t(plan.nameKey)}</h2>
            {plan.discountBadge ? (
              <Badge tone="success">{plan.discountBadge[language]}</Badge>
            ) : null}
          </div>
          {highlight ? (
            <p className="mt-1.5 text-[13px] leading-5 text-muted">{highlight}</p>
          ) : null}
        </div>

        <dl className="flex flex-col gap-2.5 rounded-xl border border-stroke bg-canvas p-4 text-[13px]">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">{t('checkout.planPrice')}</dt>
            <dd className="font-semibold text-text tabular-nums">
              {plan.originalPriceMonthly ? (
                <s className="mr-1.5 font-normal text-subtle">${plan.originalPriceMonthly}</s>
              ) : null}
              ${plan.priceMonthly}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">{t('checkout.fee')}</dt>
            <dd
              className={cn(
                'font-semibold tabular-nums',
                feeUsd > 0 ? 'text-text' : 'text-success',
              )}
            >
              ${feeUsd.toFixed(2)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-stroke pt-2.5 text-base font-semibold text-text">
            <dt>{t('checkout.total')}</dt>
            <dd className="text-gradient tabular-nums">
              ${feeUsd > 0 ? (plan.priceMonthly + feeUsd).toFixed(2) : plan.priceMonthly}
            </dd>
          </div>
        </dl>

        <div className="border-t border-stroke pt-4">
          <p className="text-[13px] font-semibold text-text">{t('checkout.included')}</p>
          <ul className="mt-2.5 flex flex-col gap-2 text-[13px] leading-5 text-muted">
            {PERKS.map((key) => (
              <li key={key} className="flex items-start gap-2">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-accent" />
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="flex items-center gap-2 text-xs text-muted">
          <LockIcon className="size-3.5 shrink-0 text-accent" />
          <span>{t('checkout.secure')}</span>
        </p>
      </Card>
    </aside>
  );
}

const PACK_PERKS = ['packs.perk1', 'packs.perk2', 'packs.perk3'] as const;

/** Сводка заказа для пакета премиум-квоты: сколько квоты, на сколько дней и как тратится. */
export function PackSummary({ pack, feeUsd = 0 }: { pack: PremiumPack; feeUsd?: number }) {
  const { t } = useTranslation();
  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
      <Card className="flex flex-col gap-5 overflow-hidden rounded-2xl border-stroke p-5 sm:p-6">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
        <div className="flex items-center justify-between gap-3 border-b border-stroke pb-4">
          <span className="text-[13px] font-medium text-muted">{t('packs.selected')}</span>
          <Badge tone="brand">{t('packs.days', { days: pack.days })}</Badge>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-text">
            {t('packs.name', { quota: pack.quotaUsd })}
          </h2>
          <p className="mt-1.5 text-[13px] leading-5 text-muted">{t('packs.lead')}</p>
        </div>
        <dl className="flex flex-col gap-2.5 rounded-xl border border-stroke bg-canvas p-4 text-[13px]">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">{t('packs.price')}</dt>
            <dd className="font-semibold text-text tabular-nums">${pack.priceUsd}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">{t('checkout.fee')}</dt>
            <dd
              className={cn(
                'font-semibold tabular-nums',
                feeUsd > 0 ? 'text-text' : 'text-success',
              )}
            >
              ${feeUsd.toFixed(2)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-stroke pt-2.5 text-base font-semibold text-text">
            <dt>{t('checkout.total')}</dt>
            <dd className="text-gradient tabular-nums">
              ${feeUsd > 0 ? (pack.priceUsd + feeUsd).toFixed(2) : pack.priceUsd}
            </dd>
          </div>
        </dl>
        <ul className="flex flex-col gap-2 border-t border-stroke pt-4 text-[13px] leading-5 text-muted">
          {PACK_PERKS.map((key) => (
            <li key={key} className="flex items-start gap-2">
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-accent" />
              <span>{t(key, { days: pack.days })}</span>
            </li>
          ))}
        </ul>
      </Card>
    </aside>
  );
}
