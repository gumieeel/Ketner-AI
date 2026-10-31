import { REFUND_DAYS } from '@/features/content/legal';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

interface WithdrawalConsentProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

/**
 * Согласие на мгновенное предоставление услуги и признание, что право отказа от договора на уже
 * потраченные кредиты теряется. Для потребителей из ЕС и Великобритании это условие, при котором
 * оплата без периода отказа законна (директива 2011/83/EU, ст. 16 «m»): согласие должно быть
 * активным и предшествовать оплате. Поэтому галочка не отмечена заранее.
 */
export function WithdrawalConsent({ checked, onChange, className }: WithdrawalConsentProps) {
  const { t } = useTranslation();
  return (
    <label
      className={cn(
        'flex min-h-11 cursor-pointer items-start gap-2.5 rounded-xl border border-stroke bg-surface p-3 select-none',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-soft',
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-accent"
      />
      <span className="text-[13px] leading-5 text-muted">
        {t('checkout.withdrawalConsent', { days: REFUND_DAYS })}
      </span>
    </label>
  );
}
