import { useEffect, useState } from 'react';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

interface Budget {
  day: string;
  spentUsd: number;
  limitUsd: number;
  share: number;
  resetsAt: string;
}

/**
 * Суточный бюджет сервиса на бесплатное создание и проверку (P2, $3 в сутки для аккаунтов без
 * тарифа). Один злоупотребляющий со многими аккаунтами может выбрать его для всех до 00:00 UTC —
 * поэтому значение видно на странице администратора, а с 80% приходит сигнал в бот поддержки.
 */
export function FreeBudgetPanel({ headers }: { headers: () => HeadersInit }) {
  const { t } = useTranslation();
  const [budget, setBudget] = useState<Budget | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/admin/free-build-budget', { headers: headers(), credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { budget: Budget };
        if (alive) setBudget(body.budget);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [headers]);

  if (failed) {
    return (
      <p className="rounded-xl border border-stroke bg-surface px-4 py-3 text-sm text-muted">
        {t('admin.freeBudget.unavailable')}
      </p>
    );
  }
  if (!budget) return null;
  const percent = Math.min(100, Math.round(budget.share * 100));
  const high = budget.share >= 0.8;
  return (
    <section
      aria-label={t('admin.freeBudget.title')}
      className={cn(
        'rounded-xl border px-4 py-3',
        high ? 'border-warning/30 bg-warning-soft' : 'border-stroke bg-surface',
      )}
    >
      <p className="text-sm font-medium text-text">{t('admin.freeBudget.title')}</p>
      <p className="mt-1 text-sm text-text tabular-nums">
        {t('admin.freeBudget.value', {
          spent: budget.spentUsd.toFixed(2),
          limit: budget.limitUsd.toFixed(2),
          percent,
        })}
      </p>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className={cn('h-full rounded-full', high ? 'bg-warning' : 'bg-accent')}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-muted">
        {high ? t('admin.freeBudget.high') : t('admin.freeBudget.hint')}
      </p>
    </section>
  );
}
