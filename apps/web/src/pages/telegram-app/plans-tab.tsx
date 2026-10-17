import { useState } from 'react';
import { CheckIcon, CryptoIcon, StarIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ApiError, miniAppApi, type MiniAppPlan } from '@/features/telegram/api';
import { haptic } from '@/features/telegram/webapp';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import {
  formatDate,
  formatStars,
  Notice,
  PLAN_HINT,
  Segmented,
  SectionTitle,
  subscriptionInfo,
  useMiniApp,
} from './shared';

/** Цена в звёздах округляется до 10 ⭐ (≈ $0.20): разница меньше этой — не «дороже». */
const STARS_ROUNDING_USD = 0.25;

type Mode = 'once' | 'auto';

export function PlansTab({
  recurring,
  onRecurringChange,
}: {
  recurring: boolean;
  onRecurringChange: (value: boolean) => void;
}) {
  const { t, language } = useTranslation();
  const { app, token, state, refresh, notify, openSite } = useMiniApp();
  const { user, plans, rate, autoRenew, refundPolicy } = state;
  const info = subscriptionInfo(state);
  const [paying, setPaying] = useState<string | null>(null);
  const mode: Mode = recurring ? 'auto' : 'once';
  const activeAuto = autoRenew?.status === 'active' ? autoRenew : null;

  const waitForPayment = async (invoiceId: string) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const { status } = await miniAppApi.invoiceStatus(token, invoiceId);
        if (status === 'paid') return true;
      } catch {
        // сеть мигнула — пробуем дальше
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return false;
  };

  const pay = async (plan: MiniAppPlan) => {
    haptic.tap(app);
    setPaying(plan.id);
    try {
      const invoice = await miniAppApi.invoice(token, plan.id, recurring);
      app.openInvoice(invoice.link, (status) => {
        if (status === 'paid') {
          notify('info', t('tg.paymentProcessing'));
          void waitForPayment(invoice.invoiceId)
            .then(async (paid) => {
              await refresh();
              if (paid) haptic.success(app);
              notify(
                'success',
                paid
                  ? t(recurring ? 'tg.paymentDoneAuto' : 'tg.paymentDone', { plan: plan.title })
                  : t('tg.paymentLate'),
              );
            })
            .finally(() => setPaying(null));
          return;
        }
        if (status === 'failed') {
          haptic.error(app);
          notify('danger', t('tg.paymentFailed'));
        }
        setPaying(null);
      });
    } catch (error) {
      haptic.error(app);
      notify('danger', error instanceof ApiError ? error.message : t('tg.errorGeneric'));
      setPaying(null);
    }
  };

  if (user.isVip) {
    return <Notice tone="info">{t('tg.vipPlans')}</Notice>;
  }

  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label={t('tg.payMode')}
        value={mode}
        onChange={(value) => {
          haptic.select(app);
          onRecurringChange(value === 'auto');
        }}
        options={[
          { value: 'once', label: t('tg.modeOnce') },
          { value: 'auto', label: t('tg.modeAuto') },
        ]}
      />
      <p className="px-1 text-[13px] leading-5 text-muted">
        {recurring ? t('tg.modeAutoHint') : t('tg.modeOnceHint')}
      </p>
      {recurring && activeAuto ? (
        <Notice tone="info">
          {t('tg.autoReplace', {
            plan: plans.find((plan) => plan.id === activeAuto.planId)?.title ?? activeAuto.planId,
          })}
        </Notice>
      ) : null}

      <SectionTitle aside={recurring ? t('tg.perMonthAuto') : t('tg.perMonth')}>
        {info.running ? t('tg.plansRenew') : t('tg.plansBuy')}
      </SectionTitle>

      {plans.map((plan) => {
        const isCurrent = info.running && plan.id === info.plan;
        const autoHere = recurring && activeAuto?.planId === plan.id;
        const stars = formatStars(plan.stars, language);
        const { preview } = plan;
        const label = recurring
          ? t('tg.subscribe', { stars })
          : preview.mode === 'extend'
            ? t('tg.renew', { stars })
            : preview.mode === 'switch'
              ? t('tg.switch', { plan: plan.title, stars })
              : t('tg.buy', { stars });
        return (
          <article
            key={plan.id}
            aria-labelledby={`tg-plan-${plan.id}`}
            className={cn(
              'flex flex-col gap-3 rounded-xl border bg-surface p-4',
              isCurrent ? 'border-accent/60' : 'border-stroke',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3
                  id={`tg-plan-${plan.id}`}
                  className="flex items-center gap-2 text-[17px] font-semibold"
                >
                  {plan.title}
                  {isCurrent ? (
                    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-accent">
                      <CheckIcon className="size-3.5" />
                      {t('tg.current')}
                    </span>
                  ) : null}
                </h3>
                <p className="mt-0.5 text-[13px] leading-5 text-muted">
                  {t(PLAN_HINT[plan.id] ?? 'tg.planPlusHint')}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="flex items-center justify-end gap-1 text-[18px] font-semibold tabular-nums">
                  {stars}
                  <StarIcon className="size-4 fill-warning text-warning" />
                </p>
                <p className="text-[12px] text-subtle">≈ ${plan.starsUsd.toFixed(2)}</p>
              </div>
            </div>
            <div className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] leading-5">
              <p className="text-text">
                {preview.mode === 'extend'
                  ? t('tg.previewExtend', { date: formatDate(preview.renewsAt, language) })
                  : preview.mode === 'switch'
                    ? t('tg.previewSwitch', { date: formatDate(preview.renewsAt, language) })
                    : t('tg.previewNew', { date: formatDate(preview.renewsAt, language) })}
                {recurring ? ` ${t('tg.previewThenAuto')}` : ''}
              </p>
              {preview.mode === 'switch' && preview.bonusDays > 0 ? (
                <p className="mt-0.5 text-accent">
                  {t('tg.previewBonus', { days: preview.bonusDays })}
                </p>
              ) : null}
              {preview.mode === 'switch' && preview.bonusDays === 0 && info.running ? (
                <p className="mt-0.5 text-muted">{t('tg.previewNoBonus')}</p>
              ) : null}
            </div>
            <Button
              variant={isCurrent || !info.running || recurring ? 'primary' : 'outline'}
              className="w-full"
              loading={paying === plan.id}
              disabled={paying !== null || autoHere}
              onClick={() => void pay(plan)}
            >
              {autoHere ? t('tg.autoAlready') : label}
            </Button>
          </article>
        );
      })}

      <div className="flex flex-col gap-1.5 px-1 text-[12px] leading-5 text-subtle">
        <p>{t('tg.refundShort', { hours: refundPolicy.hours })}</p>
        <p>{t('tg.rate', { per1000: (rate.usdPerStar * 1000).toFixed(2) })}</p>
        {plans.some((plan) => plan.starsUsd - plan.priceUsd > STARS_ROUNDING_USD) ? (
          <p>
            {t('tg.starsDearer', {
              prices: plans.map((plan) => `$${plan.priceUsd}`).join(' / '),
            })}
          </p>
        ) : null}
        {rate.market ? (
          <p>{t('tg.rateMarket', { per1000: (rate.market.usdPerStar * 1000).toFixed(2) })}</p>
        ) : null}
      </div>
      <Button
        variant="ghost"
        className="w-full gap-2"
        onClick={() =>
          void openSite(`/checkout/${info.running && info.plan !== 'free' ? info.plan : 'plus'}`)
        }
      >
        <CryptoIcon className="size-4" />
        {t('tg.payCrypto')}
      </Button>
    </div>
  );
}
