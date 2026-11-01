import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CreditsIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { useAuth } from '@/features/auth/auth-store';
import {
  fetchAutomation,
  openAutomationPortal,
  startAutomationCheckout,
  type AutomationInfo,
} from '@/features/billing/api';
import planFacts from '@/features/billing/plan-facts.json';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatCredits, formatDateTime } from '@/lib/format-date';

const PLAN = planFacts.automation;

/**
 * Подписка «Автоматизации» (docs/AUTOMATION_PLAN.md, этап E): $15 в месяц = 7 500 кредитов, первый
 * месяц бесплатно с картой (Dodo Payments). Условия видны всем (в том числе в пререндере), кнопка
 * зависит от входа и от того, подключена ли оплата картой на сервере.
 */
export function AutomationPlan({
  compact = false,
  returnPath,
}: {
  compact?: boolean;
  returnPath?: string;
}) {
  const { t, language } = useTranslation();
  const location = useLocation();
  const user = useAuth((state) => state.user);
  const [info, setInfo] = useState<AutomationInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = returnPath ?? location.pathname;

  useEffect(() => {
    if (!user) return;
    let alive = true;
    fetchAutomation().then(
      (value) => alive && setInfo(value),
      () => alive && setInfo(null),
    );
    return () => {
      alive = false;
    };
  }, [user]);

  const go = async (action: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      window.location.assign(await action());
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : t('automation.failed'));
      setBusy(false);
    }
  };

  const subscription = info?.subscription ?? null;
  const subscribed =
    subscription !== null &&
    (subscription.status === 'active' || subscription.status === 'past_due');
  const amount = (value: number) => formatCredits(value, language);

  let action;
  if (!user) {
    action = (
      <Link
        to={`/signup?redirect=${encodeURIComponent(back)}`}
        className={buttonClasses({ variant: 'primary', className: 'w-full md:w-auto' })}
      >
        {t('automation.start', { days: PLAN.trialDays })}
      </Link>
    );
  } else if (subscription) {
    action = (
      <Button
        variant="outline"
        loading={busy}
        disabled={busy || !info?.available}
        className="w-full md:w-auto"
        onClick={() => void go(openAutomationPortal)}
      >
        {t('automation.manage')}
      </Button>
    );
  } else {
    action = (
      <Button
        loading={busy}
        disabled={busy || !info?.available}
        className="w-full md:w-auto"
        onClick={() => void go(() => startAutomationCheckout(back))}
      >
        {t('automation.start', { days: PLAN.trialDays })}
      </Button>
    );
  }

  return (
    <section
      aria-labelledby="automation-plan-title"
      data-testid="automation-plan"
      className={cn(
        'grid grid-cols-1 gap-5 rounded-xl border border-accent/30 bg-accent-soft/40 px-6 py-6 md:grid-cols-[1fr_auto] md:items-center',
        compact ? 'md:px-6' : 'md:px-8',
      )}
    >
      <div className="flex flex-col gap-2">
        <h2
          id="automation-plan-title"
          className="flex items-center gap-2.5 text-[20px] font-medium text-text"
        >
          <CreditsIcon className="size-5 shrink-0 text-accent" aria-hidden="true" />
          {t('automation.title', { price: PLAN.priceUsd })}
        </h2>
        <p className="max-w-[70ch] text-[14px] leading-relaxed text-text">
          {t('automation.lead', {
            credits: amount(PLAN.monthlyCredits),
            days: PLAN.trialDays,
            trial: amount(PLAN.trialCredits),
          })}
        </p>
        <p className="max-w-[70ch] text-[13px] leading-relaxed text-muted">
          {t('automation.terms', { days: 3 })}
        </p>
        {subscription ? (
          <p className="text-[13px] font-medium text-text" role="status">
            {subscribed &&
            subscription.trialEndsAt &&
            Date.parse(subscription.trialEndsAt) > Date.now()
              ? t('automation.status.trial', {
                  date: formatDateTime(subscription.trialEndsAt, language),
                })
              : subscribed
                ? subscription.cancelAtPeriodEnd
                  ? t('automation.status.cancelling', {
                      date: formatDateTime(subscription.nextBillingDate ?? '', language),
                    })
                  : t('automation.status.active', {
                      date: formatDateTime(subscription.nextBillingDate ?? '', language),
                    })
                : t('automation.status.inactive')}
          </p>
        ) : null}
        {user && info && !info.available ? (
          <p className="text-[13px] text-muted">{t('automation.unavailable')}</p>
        ) : null}
        {error ? (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </div>
      {action}
    </section>
  );
}
