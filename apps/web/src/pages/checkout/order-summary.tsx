import { CheckIcon, LockIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PACK_VALID_DAYS, type PackFacts } from '@/features/billing/plans';
import { useTranslation, type TranslationKey } from '@/i18n';
import { formatCredits, pluralForm } from '@/lib/format-date';

const PERKS = ['checkout.perk1', 'checkout.perk2', 'checkout.perk3'] as const;

export interface OrderSummaryProps {
  pack: PackFacts;
  /** Бонус кредитами за оплату криптовалютой; 0, если выбран другой способ. */
  bonusCredits?: number;
  feeUsd?: number;
}

/** Сводка заказа справа: пакет, кредиты, цена, что входит и строка о безопасности. */
export function OrderSummary({ pack, bonusCredits = 0, feeUsd = 0 }: OrderSummaryProps) {
  const { t, language } = useTranslation();
  const credits = (count: number): string =>
    t(`pricing.credits.${pluralForm(count, language)}` as TranslationKey, {
      count: formatCredits(count, language),
    });
  const total = pack.priceUsd + feeUsd;

  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
      <Card className="flex flex-col gap-5 overflow-hidden rounded-2xl border-accent/30 p-5 ring-1 ring-accent/15 sm:p-6">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-brand-gradient" />

        <div className="flex items-center justify-between gap-3 border-b border-stroke pb-4">
          <span className="text-[13px] font-medium text-muted">{t('checkout.selectedPack')}</span>
          <Badge tone="brand">{t('checkout.validDays', { days: PACK_VALID_DAYS })}</Badge>
        </div>

        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-2xl font-semibold tracking-tight text-text tabular-nums">
              {credits(pack.credits)}
            </h2>
            {pack.discountPct > 0 ? <Badge tone="success">−{pack.discountPct}%</Badge> : null}
          </div>
          <p className="mt-1.5 text-[13px] leading-5 text-muted">
            {t('pricing.perThousand', { price: `$${pack.pricePerThousandUsd.toFixed(2)}` })}
          </p>
        </div>

        <dl className="flex flex-col gap-2.5 rounded-xl border border-stroke bg-canvas p-4 text-[13px]">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">{t('checkout.packPrice')}</dt>
            <dd className="font-semibold text-text tabular-nums">${pack.priceUsd}</dd>
          </div>
          {bonusCredits > 0 ? (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">{t('checkout.cryptoBonusLine')}</dt>
              <dd className="font-semibold text-success tabular-nums">
                +{formatCredits(bonusCredits, language)}
              </dd>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">{t('checkout.fee')}</dt>
            <dd
              className={
                feeUsd > 0
                  ? 'font-semibold text-text tabular-nums'
                  : 'font-semibold text-success tabular-nums'
              }
            >
              ${feeUsd.toFixed(2)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-stroke pt-2.5 text-base font-semibold text-text">
            <dt>{t('checkout.total')}</dt>
            <dd className="text-gradient tabular-nums">
              ${feeUsd > 0 ? total.toFixed(2) : pack.priceUsd}
            </dd>
          </div>
        </dl>

        <div className="border-t border-stroke pt-4">
          <p className="text-[13px] font-semibold text-text">{t('checkout.included')}</p>
          <ul className="mt-2.5 flex flex-col gap-2 text-[13px] leading-5 text-muted">
            {PERKS.map((key) => (
              <li key={key} className="flex items-start gap-2">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-accent" />
                <span>{t(key, { days: PACK_VALID_DAYS })}</span>
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
