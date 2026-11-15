import { useState } from 'react';
import {
  ChevronRightIcon,
  CreditsIcon,
  FileTextIcon,
  MessagesIcon,
  ShieldIcon,
  StarIcon,
  TelegramIcon,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ApiError, miniAppApi } from '@/features/telegram/api';
import { haptic } from '@/features/telegram/webapp';
import { legacyPlanName } from '@/features/billing/plan-badge';
import { useTranslation } from '@/i18n';
import { formatCredits } from '@/lib/format-date';
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
import { appHomePath, productSwitch } from '@/lib/product-switches';

export function HomeTab() {
  const { t, language } = useTranslation();
  const { app, token, state, setState, notify, goTo, openSite } = useMiniApp();
  const { user, autoRenew, credits, payments } = state;
  const info = subscriptionInfo(state);
  const [savingAuto, setSavingAuto] = useState(false);
  const [opening, setOpening] = useState(false);
  const pendingRefund = payments.find((payment) => payment.status === 'refund_requested');
  const hasPurchases = payments.some((payment) => payment.status === 'paid');
  const activeAuto = autoRenew?.status === 'active' ? autoRenew : null;

  // Автопродление прежней подписки можно только выключить: новых подписок нет.
  const stopAuto = async () => {
    setSavingAuto(true);
    try {
      setState(await miniAppApi.autoRenew(token, false));
      haptic.success(app);
      notify('success', t('tg.autoOffDone'));
    } catch (error) {
      haptic.error(app);
      notify('danger', error instanceof ApiError ? error.message : t('tg.errorGeneric'));
    } finally {
      setSavingAuto(false);
    }
  };

  // Пакеты звёздами — пока Stars открыты (lib/product-switches.ts); иначе — пакет на сайте.
  const topUp = () => {
    if (productSwitch('stars')) goTo('plans');
    else void openSite('/pricing');
  };

  const openChat = async () => {
    setOpening(true);
    try {
      await openSite(appHomePath());
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel aria-labelledby="tg-credits-title">
        <p id="tg-credits-title" className="text-[13px] text-muted">
          {t('tg.creditsTitle')}
        </p>
        <p className="mt-1 flex items-center gap-2 text-[28px] font-semibold tracking-tight tabular-nums">
          <CreditsIcon className="size-6 text-accent" aria-hidden="true" />
          {formatCredits(credits.balance, language)}
        </p>
        <p className="mt-1 text-[14px] leading-6 text-muted">
          {user.isVip
            ? t('tg.vip')
            : hasPurchases
              ? t('tg.creditsText', { days: credits.validDays })
              : t('tg.creditsTrial', { trial: formatCredits(credits.trialCredits, language) })}
        </p>
        {!user.isVip ? (
          <div className="mt-3 flex flex-col gap-2">
            <Button className="w-full" onClick={topUp}>
              {t('tg.topUp')}
            </Button>
          </div>
        ) : null}
      </Panel>

      {!user.isVip && info.running ? (
        <Panel aria-labelledby="tg-legacy-title">
          <p id="tg-legacy-title" className="text-[13px] text-muted">
            {t('tg.legacyTitle')}
          </p>
          <p className="mt-1 text-[17px] font-semibold">{legacyPlanName(info.plan)}</p>
          <p className="mt-1 text-[14px] leading-6 text-muted">
            {t('tg.until', { date: formatDate(info.endsAt, language), days: info.daysLeft })}
          </p>
          {activeAuto ? (
            <div className="mt-3 border-t border-stroke pt-1">
              <Toggle
                label={t('tg.autoRenew')}
                description={t('tg.legacyAutoHint', {
                  stars: formatStars(activeAuto.stars, language),
                  date: formatDate(activeAuto.nextChargeAt ?? info.endsAt, language),
                })}
                checked
                disabled={savingAuto}
                onChange={() => void stopAuto()}
              />
            </div>
          ) : null}
        </Panel>
      ) : null}

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
          label={t('tg.tabCredits')}
          onClick={topUp}
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
