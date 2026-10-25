import { useState } from 'react';
import {
  ChevronRightIcon,
  FileTextIcon,
  MessagesIcon,
  RefreshIcon,
  ShieldIcon,
  StarIcon,
  TelegramIcon,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ApiError, miniAppApi } from '@/features/telegram/api';
import { haptic } from '@/features/telegram/webapp';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import {
  formatDate,
  formatStars,
  Notice,
  Panel,
  SUPPORT_URL,
  subscriptionInfo,
  Toggle,
  useMiniApp,
} from './shared';

export function HomeTab() {
  const { t, language } = useTranslation();
  const { app, token, state, setState, notify, goTo, openSite } = useMiniApp();
  const { user, autoRenew, plans, payments } = state;
  const info = subscriptionInfo(state);
  const planTitle = (id: string) =>
    plans.find((plan) => plan.id === id)?.title ?? (id === 'free' ? 'Free' : id);
  const [savingAuto, setSavingAuto] = useState(false);
  const [opening, setOpening] = useState(false);
  const pendingRefund = payments.find((payment) => payment.status === 'refund_requested');

  const toggleAuto = async (enabled: boolean) => {
    setSavingAuto(true);
    try {
      setState(await miniAppApi.autoRenew(token, enabled));
      haptic.success(app);
      notify('success', enabled ? t('tg.autoOnDone') : t('tg.autoOffDone'));
    } catch (error) {
      haptic.error(app);
      notify('danger', error instanceof ApiError ? error.message : t('tg.errorGeneric'));
    } finally {
      setSavingAuto(false);
    }
  };

  const openChat = async () => {
    setOpening(true);
    try {
      await openSite('/chat');
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel aria-labelledby="tg-sub-title">
        <p id="tg-sub-title" className="text-[13px] text-muted">
          {t('tg.subscription')}
        </p>
        <p className="mt-1 text-[24px] font-semibold tracking-tight">
          {user.isVip ? 'Ultra · VIP' : planTitle(info.plan)}
        </p>
        {user.isVip ? (
          <p className="mt-1 text-[14px] text-muted">{t('tg.vip')}</p>
        ) : info.running ? (
          <>
            <p className="mt-1 text-[14px] text-muted">
              {t('tg.until', { date: formatDate(info.endsAt, language), days: info.daysLeft })}
            </p>
            <div
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={30}
              aria-valuenow={Math.min(30, info.daysLeft)}
              aria-label={t('tg.daysLeft', { days: info.daysLeft })}
            >
              <div
                className={cn(
                  'h-full rounded-full',
                  info.daysLeft <= 3 ? 'bg-warning' : 'bg-accent',
                )}
                style={{ width: `${Math.min(100, (info.daysLeft / 30) * 100)}%` }}
              />
            </div>
          </>
        ) : (
          <p className="mt-1 text-[14px] leading-6 text-muted">{t('tg.freeText')}</p>
        )}

        {!user.isVip && autoRenew ? (
          <div className="mt-3 border-t border-stroke pt-1">
            <Toggle
              label={t('tg.autoRenew')}
              description={
                autoRenew.status === 'active'
                  ? t('tg.autoOnHint', {
                      plan: planTitle(autoRenew.planId),
                      stars: formatStars(autoRenew.stars, language),
                      date: formatDate(autoRenew.nextChargeAt ?? info.endsAt, language),
                    })
                  : t('tg.autoOffHint', { date: formatDate(info.endsAt, language) })
              }
              checked={autoRenew.status === 'active'}
              disabled={savingAuto}
              onChange={(next) => void toggleAuto(next)}
            />
          </div>
        ) : null}

        {!user.isVip ? (
          <div className="mt-3 flex flex-col gap-2">
            {info.running ? (
              <Button className="w-full" onClick={() => goTo('plans')}>
                {t('tg.renewOrSwitch')}
              </Button>
            ) : (
              <Button className="w-full" onClick={() => goTo('plans')}>
                {t('tg.choosePlan')}
              </Button>
            )}
            {info.running && !autoRenew ? (
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => goTo('plans', { recurring: true })}
              >
                <RefreshIcon className="size-4" />
                {t('tg.enableAuto')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </Panel>

      {pendingRefund ? (
        <Notice tone="info">
          {t('tg.refundPendingHome', {
            plan: pendingRefund.planTitle,
            date: formatDate(pendingRefund.refund?.requestedAt, language),
          })}
        </Notice>
      ) : null}

      {user.isAdmin && state.pendingRefunds > 0 ? (
        <button
          type="button"
          onClick={() => goTo('admin')}
          className="flex min-h-12 items-center gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-left text-[14px]"
        >
          <ShieldIcon className="size-5 shrink-0 text-warning" />
          <span className="flex-1">{t('tg.adminBanner', { count: state.pendingRefunds })}</span>
          <ChevronRightIcon className="size-4 text-muted" />
        </button>
      ) : null}

      <nav aria-label={t('tg.quickActions')} className="grid grid-cols-2 gap-2">
        <QuickAction
          icon={<MessagesIcon className="size-5" />}
          label={t('tg.openChat')}
          busy={opening}
          onClick={() => void openChat()}
        />
        <QuickAction
          icon={<StarIcon className="size-5" />}
          label={t('tg.tabPlans')}
          onClick={() => goTo('plans')}
        />
        <QuickAction
          icon={<FileTextIcon className="size-5" />}
          label={t('tg.tabPayments')}
          onClick={() => goTo('payments')}
        />
        <QuickAction
          icon={<TelegramIcon className="size-5" />}
          label={t('tg.support')}
          onClick={() => app.openTelegramLink(SUPPORT_URL)}
        />
      </nav>
    </div>
  );
}

function QuickAction({
  icon,
  label,
  busy,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy || undefined}
      className={cn(
        'flex min-h-[76px] flex-col items-start justify-between gap-2 rounded-xl border border-stroke bg-surface p-3 text-left',
        'transition-colors duration-150 hover:border-stroke-strong hover:bg-surface-2 disabled:opacity-60',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
      )}
    >
      <span className="text-accent">{icon}</span>
      <span className="text-[14px] font-medium leading-5">{label}</span>
    </button>
  );
}
