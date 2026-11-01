import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AlertIcon, CreditsIcon } from '@/components/icons';
import { useAuth } from '@/features/auth/auth-store';
import { reasoningModeFor } from '@/features/chat/reasoning-mode';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useCredits } from '@/features/usage/credits-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatCredits } from '@/lib/format-date';

/** Не чаще раза в столько миллисекунд шапка перезапрашивает остаток (переход, возврат на вкладку). */
const REFRESH_MS = 30_000;
let lastRefresh = 0;

/**
 * Остаток кредитов в шапке (docs/AUTOMATION_PLAN.md, этап C): виден на всех страницах после входа,
 * ведёт на «Кредиты». Кредиты на исходе или кончились — предупреждающий цвет и значок.
 */
export function BalanceChip({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  const { t, language } = useTranslation();
  const user = useAuth((state) => state.user);
  const maxMode = usePreferences((state) => state.maxMode);
  const report = useCredits((state) => state.report);
  const refresh = useCredits((state) => state.refresh);
  const mode = reasoningModeFor(user, maxMode);

  useEffect(() => {
    if (!user) return;
    const update = () => {
      if (Date.now() - lastRefresh < REFRESH_MS) return;
      lastRefresh = Date.now();
      void refresh(mode);
    };
    if (!useCredits.getState().report) lastRefresh = 0;
    update();
    const onVisible = () => {
      if (document.visibilityState === 'visible') update();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [user, mode, refresh]);

  if (!user || !report) return null;
  const attention = report.stage === 'exhausted' || report.low;
  const amount = formatCredits(report.balance, language);
  return (
    <Link
      to="/pricing"
      onClick={onNavigate}
      aria-label={t(attention ? 'credits.headerLow' : 'credits.headerLabel', { count: amount })}
      title={t(attention ? 'credits.headerLow' : 'credits.headerLabel', { count: amount })}
      data-testid="balance-chip"
      className={cn(
        'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium tabular-nums transition-colors max-md:min-h-11',
        attention
          ? 'border-warning/40 bg-warning-soft text-text hover:border-warning'
          : 'border-stroke text-text hover:border-stroke-strong hover:bg-surface-2',
        className,
      )}
    >
      {attention ? (
        <AlertIcon className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
      ) : (
        <CreditsIcon className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
      )}
      <span aria-hidden="true">{amount}</span>
    </Link>
  );
}
