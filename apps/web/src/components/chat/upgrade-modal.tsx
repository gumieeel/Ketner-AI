import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertIcon, CloseIcon, SparkleIcon } from '@/components/icons';
import { CornerMark } from '@/components/ui/corner-mark';
import { useAuth } from '@/features/auth/auth-store';
import { useUpgradeModal } from '@/features/billing/upgrade-modal-store';
import { DEFAULT_MODEL_ID, usePreferences } from '@/features/preferences/preferences-store';
import { useTranslation } from '@/i18n';

interface PlanPreview {
  id: string;
  name: string;
  price: string;
  badge?: string;
  highlight: string;
  models: string;
}

const PLANS_PREVIEW: PlanPreview[] = [
  {
    id: 'plus',
    name: 'Plus',
    price: '$9',
    highlight: 'GPT-4o, DeepSeek Flash',
    models: 'GPT-4o, Claude Haiku 4.5, DeepSeek V4.1 Flash',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$25',
    badge: 'Популярный',
    highlight: 'Все флагманы',
    models: 'GPT-6 Astra, Claude Fable, Gemini Flash, Grok',
  },
  {
    id: 'ultra',
    name: 'Ultra',
    price: '$49 (скидка вместо $59)',
    badge: 'Все включено',
    highlight: 'Без лимитов',
    models: 'Все топовые модели на 100% + VIP-приоритет',
  },
];

/**
 * Модальное окно перехода на тариф PRO / Ultra.
 *
 * Затемняет весь экран (backdrop-blur-md + dark overlay) в двух случаях:
 * 1. Исчерпан часовой лимит бесплатного тарифа (3 сообщения в час).
 * 2. Пользователь пытается написать, выбрав платную модель без подписки.
 */
export function UpgradeModal() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isOpen = useUpgradeModal((state) => state.isOpen);
  const reason = useUpgradeModal((state) => state.reason);
  const modelName = useUpgradeModal((state) => state.modelName);
  const requiredPlan = useUpgradeModal((state) => state.requiredPlan);
  const close = useUpgradeModal((state) => state.close);
  const setChatModelId = usePreferences((state) => state.setChatModelId);
  const user = useAuth((state) => state.user);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, close]);

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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={close}
    >
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-xl border border-stroke bg-surface p-6 shadow-2xl sm:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <CornerMark size={14} className="pointer-events-none absolute top-3 left-3 text-accent" />
        <CornerMark
          size={14}
          className="pointer-events-none absolute bottom-3 right-3 text-accent rotate-180"
        />

        <button
          type="button"
          onClick={close}
          aria-label={t('chat.close')}
          className="absolute top-4 right-4 rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-text transition-colors"
        >
          <CloseIcon />
        </button>

        {/* Badge & Title */}
        <div className="mb-4">
          {reason === 'free_limit' ? (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning-soft px-3 py-1 text-xs font-semibold text-warning mb-2.5">
              <AlertIcon className="size-3.5 text-warning" aria-hidden="true" />
              <span>{t('chat.freeLimitBadge')}</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft px-3 py-1 text-xs font-semibold text-accent mb-2.5">
              <SparkleIcon className="size-3.5 text-accent" aria-hidden="true" />
              <span>{t('chat.paidModelBadge')}</span>
            </div>
          )}

          <h2 id="upgrade-modal-title" className="text-xl font-semibold text-text tracking-tight">
            {reason === 'free_limit'
              ? t('chat.freeLimitTitle')
              : t('chat.paidModelTitle', { model: modelName || 'PRO' })}
          </h2>

          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {reason === 'free_limit'
              ? t('chat.freeLimitDesc')
              : t('chat.paidModelDesc', {
                  model: modelName || 'PRO',
                  plan: requiredPlan || 'PRO',
                })}
          </p>
        </div>

        {/* Preview of 4 Plans */}
        <div className="mb-5 grid grid-cols-2 gap-2.5">
          {PLANS_PREVIEW.map((plan) => (
            <button
              key={plan.id}
              type="button"
              onClick={() => handleSelectPlan(plan.id)}
              className="group relative flex flex-col text-left rounded-lg border border-stroke bg-canvas p-3 transition-all hover:border-stroke-strong hover:bg-surface-2"
            >
              {plan.badge ? (
                <span className="absolute top-2 right-2 rounded-sm bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent uppercase tracking-wider">
                  {plan.badge}
                </span>
              ) : null}
              <span className="text-xs font-semibold text-text group-hover:text-accent transition-colors">
                {plan.name}
              </span>
              <span className="mt-1 text-sm font-semibold text-text font-mono">{plan.price}</span>
              <span className="text-[11px] text-muted">{plan.highlight}</span>
              <span className="mt-1.5 line-clamp-1 text-[10px] text-subtle">{plan.models}</span>
            </button>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2.5 sm:flex-row-reverse sm:items-center">
          <Link
            to="/pricing"
            onClick={close}
            className="inline-flex w-full sm:flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-text shadow-sm transition hover:opacity-90 text-center"
          >
            <span>{t('chat.viewPlans')}</span>
            <span aria-hidden="true">→</span>
          </Link>

          {reason === 'paid_model' ? (
            <button
              type="button"
              onClick={handleSwitchToFree}
              className="inline-flex w-full sm:flex-1 items-center justify-center rounded-md border border-stroke bg-surface px-4 py-2.5 text-xs font-medium text-text hover:bg-surface-2 transition-colors text-center"
            >
              {t('chat.switchToFreeModel')}
            </button>
          ) : (
            <button
              type="button"
              onClick={close}
              className="inline-flex w-full sm:w-auto items-center justify-center rounded-md border border-stroke bg-surface px-4 py-2.5 text-xs font-medium text-muted hover:text-text hover:bg-surface-2 transition-colors"
            >
              {t('chat.close')}
            </button>
          )}
        </div>

        <p className="mt-3 text-center text-[11px] text-subtle">
          СБП • Банковские карты • Telegram Stars
        </p>
      </div>
    </div>
  );
}
