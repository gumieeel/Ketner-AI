import { Link, useNavigate } from 'react-router-dom';
import { AlertIcon, CloseIcon, SparkleIcon } from '@/components/icons';
import { buttonClasses } from '@/components/ui/button-classes';
import { IconButton } from '@/components/ui/icon-button';
import { Modal } from '@/components/ui/modal';
import { useAuth } from '@/features/auth/auth-store';
import { PLANS } from '@/features/billing/plans';
import { useUpgradeModal } from '@/features/billing/upgrade-modal-store';
import { DEFAULT_MODEL_ID, usePreferences } from '@/features/preferences/preferences-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

/** Платные тарифы, которые предлагает окно: цены и описания берутся из каталога тарифов. */
const PAID_PLANS = PLANS.filter((plan) => plan.priceMonthly > 0);

const TIER_DOT: Record<string, string> = {
  plus: 'bg-tier-plus',
  pro: 'bg-tier-pro',
  ultra: 'bg-tier-ultra',
};

/**
 * Модальное окно перехода на тариф PRO / Ultra.
 *
 * Затемняет весь экран (backdrop-blur-md + dark overlay) в двух случаях:
 * 1. Исчерпан часовой лимит бесплатного тарифа (3 сообщения в час).
 * 2. Пользователь пытается написать, выбрав платную модель без подписки.
 */
export function UpgradeModal() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const isOpen = useUpgradeModal((state) => state.isOpen);
  const reason = useUpgradeModal((state) => state.reason);
  const modelName = useUpgradeModal((state) => state.modelName);
  const requiredPlan = useUpgradeModal((state) => state.requiredPlan);
  const close = useUpgradeModal((state) => state.close);
  const setChatModelId = usePreferences((state) => state.setChatModelId);
  const user = useAuth((state) => state.user);

  if (!isOpen) {
    return null;
  }

  const handleSwitchToFree = () => {
    setChatModelId(DEFAULT_MODEL_ID);
    close();
  };

  const handleSelectPlan = (planId: string) => {
    close();
    if (!user) {
      navigate(`/signup?redirect=${encodeURIComponent(`/checkout/${planId}`)}`);
    } else {
      navigate(`/checkout/${planId}`);
    }
  };

  return (
    <Modal labelledBy="upgrade-modal-title" onClose={close} size="md" className="p-6 sm:p-7">
      {/* Мягкое свечение бренда за заголовком */}
      <div
        aria-hidden="true"
        className="bg-brand-soft pointer-events-none absolute -top-24 -left-16 size-72 rounded-full opacity-70 blur-3xl"
      />

      <IconButton
        label={t('chat.close')}
        size="sm"
        onClick={close}
        className="absolute top-3 right-3 z-10"
      >
        <CloseIcon className="size-4" />
      </IconButton>

      <div className="relative min-h-0 overflow-y-auto">
        {/* Badge & Title */}
        <div className="mb-5 pr-8">
          {reason === 'free_limit' ? (
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning-soft px-3 py-1 text-xs font-semibold text-warning">
              <AlertIcon className="size-3.5" aria-hidden="true" />
              <span>{t('chat.freeLimitBadge')}</span>
            </div>
          ) : (
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
              <SparkleIcon className="size-3.5" aria-hidden="true" />
              <span>{reason === 'max_mode' ? t('chat.maxModeBadge') : t('chat.paidModelBadge')}</span>
            </div>
          )}

          <h2 id="upgrade-modal-title" className="text-xl font-semibold tracking-tight text-text">
            {reason === 'free_limit'
              ? t('chat.freeLimitTitle')
              : reason === 'max_mode'
                ? t('chat.maxModeUpgradeTitle')
                : t('chat.paidModelTitle', { model: modelName || 'PRO' })}
          </h2>

          <p className="mt-2 text-sm leading-relaxed text-muted">
            {reason === 'free_limit'
              ? t('chat.freeLimitDesc')
              : reason === 'max_mode'
                ? t('chat.maxModeUpgradeDesc')
                : t('chat.paidModelDesc', {
                  model: modelName || 'PRO',
                  plan: requiredPlan || 'PRO',
                })}
          </p>
        </div>

        {/* Тарифы: клик ведёт сразу к оплате выбранного */}
        <div className="mb-5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {PAID_PLANS.map((plan) => (
            <button
              key={plan.id}
              type="button"
              onClick={() => handleSelectPlan(plan.id)}
              className={cn(
                'lift group relative flex min-h-14 items-center justify-between gap-3 rounded-xl border bg-canvas p-3.5 text-left',
                'hover:border-accent/40 hover:bg-surface-2 sm:min-h-[104px] sm:flex-col sm:items-start sm:justify-between',
                plan.popular ? 'border-accent/40 shadow-glow' : 'border-stroke',
              )}
            >
              <span className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-sm font-semibold text-text transition-colors group-hover:text-accent">
                  <span aria-hidden="true" className={cn('size-2 rounded-full', TIER_DOT[plan.id] ?? 'bg-subtle')} />
                  {t(plan.nameKey)}
                  {plan.popular ? (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
                      {t('pricing.popular')}
                    </span>
                  ) : null}
                </span>
                {plan.limitBadge ? (
                  <span className="text-xs text-muted">{plan.limitBadge[language]}</span>
                ) : null}
              </span>
              <span className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="tabular text-lg font-semibold text-text">${plan.priceMonthly}</span>
                <span className="text-xs text-muted">/{t('pricing.month')}</span>
                {plan.originalPriceMonthly ? (
                  <span className="ml-0.5 text-xs text-subtle line-through">${plan.originalPriceMonthly}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2.5 sm:flex-row-reverse sm:items-center">
          <Link
            to="/pricing"
            onClick={close}
            className={buttonClasses({ variant: 'primary', size: 'lg', className: 'w-full sm:flex-1' })}
          >
            <span>{t('chat.viewPlans')}</span>
            <span aria-hidden="true">→</span>
          </Link>

          {reason === 'paid_model' ? (
            <button
              type="button"
              onClick={handleSwitchToFree}
              className={buttonClasses({
                variant: 'outline',
                size: 'lg',
                className: 'w-full whitespace-normal text-center text-[13px] leading-tight sm:flex-1',
              })}
            >
              {t('chat.switchToFreeModel')}
            </button>
          ) : (
            <button
              type="button"
              onClick={close}
              className={buttonClasses({ variant: 'outline', size: 'lg', className: 'w-full sm:w-auto' })}
            >
              {t('chat.close')}
            </button>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-subtle">{t('upgrade.payMethods')}</p>
      </div>
    </Modal>
  );
}
