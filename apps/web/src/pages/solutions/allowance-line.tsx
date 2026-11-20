import { useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/auth-store';
import { fetchAllowance, monthPercent, type AllowanceStatus } from '@/features/builder/api';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

/**
 * Бесплатный лимит месяца одной строкой: «использовано N%» или «исчерпан, обновится 1-го». Цены
 * шагов в кредитах клиенту не показываются (docs/SUBSCRIPTION_PRICING_DESIGN.md, раздел 7) — только
 * эта строка в «Моих автоматизациях» и под отказом «лимит исчерпан». Гостю и при ошибке — ничего.
 */
export function AllowanceLine({ className }: { className?: string }) {
  const { t } = useTranslation();
  const signedIn = useAuth((state) => state.status === 'authenticated');
  const [status, setStatus] = useState<AllowanceStatus | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    fetchAllowance()
      .then((value) => {
        if (alive) setStatus(value);
      })
      .catch(() => {
        // Строка необязательна: без неё страница работает как раньше.
      });
    return () => {
      alive = false;
    };
  }, [signedIn]);

  if (!signedIn || !status) return null;
  const percent = monthPercent(status);
  return (
    <p data-testid="allowance-line" className={cn('text-[13px] text-subtle', className)}>
      {percent >= 100 ? t('allowance.exhausted') : t('allowance.month', { percent })}
    </p>
  );
}
