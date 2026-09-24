import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CloseIcon } from '@/components/icons';
import { CornerMark } from '@/components/ui/corner-mark';
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
    id: 'gpt-pro',
    name: 'GPT Pro',
    price: '1 199 ₽',
    highlight: '5-часовой лимит',
    models: 'GPT-6 Astra, Luna, 4.5',
  },
  {
    id: 'claude-pro',
    name: 'Claude Pro',
    price: '1 199 ₽',
    highlight: '5-часовой лимит',
    models: 'Claude Fable 5.5, 5.1, Sonnet',
  },
  {
    id: 'gemini-pro',
    name: 'Gemini Pro',
    price: '1 199 ₽',
    highlight: '5-часовой лимит',
    models: 'Gemini 3.8 Pro, 3.5 Flash',
  },
  {
    id: 'ultra',
    name: 'Ultra',
    price: '2 499 ₽',
    badge: 'Все включено',
    highlight: 'Без лимитов',
    models: 'Все модели GPT, Claude, Gemini, Qwen',
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
    navigate(`/checkout/${planId}`);
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
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-stroke/70 bg-surface p-6 shadow-2xl backdrop-blur-xl sm:p-7"
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
          className="absolute top-4 right-4 rounded-lg p-1.5 text-muted hover:bg-canvas hover:text-text transition-colors"
        >
          <CloseIcon />
        </button>

        {/* Badge & Title */}
        <div className="mb-4">
          {reason === 'free_limit' ? (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400 mb-2.5">
              <span aria-hidden="true">⏳</span>
              <span>{t('chat.freeLimitBadge')}</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent mb-2.5">
              <span aria-hidden="true">⭐</span>
              <span>{t('chat.paidModelBadge')}</span>
            </div>
          )}

          <h2 id="upgrade-modal-title" className="text-xl font-bold text-text tracking-tight">
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
              className="group relative flex flex-col text-left rounded-xl border border-stroke/50 bg-canvas/60 p-3 transition-all hover:border-accent hover:bg-canvas"
            >
              {plan.badge ? (
                <span className="absolute top-2 right-2 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold text-accent uppercase tracking-wider">
                  {plan.badge}
                </span>
              ) : null}
              <span className="text-xs font-semibold text-text group-hover:text-accent transition-colors">
                {plan.name}
              </span>
              <span className="mt-1 text-sm font-bold text-text">{plan.price}</span>
              <span className="text-[11px] text-muted">{plan.highlight}</span>
              <span className="mt-1.5 line-clamp-1 text-[10px] text-muted/80">{plan.models}</span>
            </button>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2.5 sm:flex-row-reverse sm:items-center">
          <Link
            to="/pricing"
            onClick={close}
            className="inline-flex w-full sm:flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-[var(--color-accent-text)] shadow-md transition hover:opacity-90 text-center"
          >
            <span>{t('chat.viewPlans')}</span>
            <span aria-hidden="true">→</span>
          </Link>

          {reason === 'paid_model' ? (
            <button
              type="button"
              onClick={handleSwitchToFree}
              className="inline-flex w-full sm:flex-1 items-center justify-center rounded-xl border border-stroke/60 bg-surface px-4 py-2.5 text-xs font-medium text-text hover:bg-canvas transition-colors text-center"
            >
              {t('chat.switchToFreeModel')}
            </button>
          ) : (
            <button
              type="button"
              onClick={close}
              className="inline-flex w-full sm:w-auto items-center justify-center rounded-xl border border-stroke/60 bg-surface px-4 py-2.5 text-xs font-medium text-muted hover:text-text hover:bg-canvas transition-colors"
            >
              {t('chat.close')}
            </button>
          )}
        </div>

        <p className="mt-3 text-center text-[11px] text-muted">
          СБП • Банковские карты • Telegram Stars ⭐️
        </p>
      </div>
    </div>
  );
}
