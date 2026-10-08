import { RefreshIcon, SbpIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { QrCode } from '@/components/ui/qr-code';
import type { Plan, SbpInvoice } from '@/features/billing/types';
import type { Language } from '@/features/preferences/preferences-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { CopyButton, Notice, PanelShell, QrFrame, StatusRow, TimerPill } from './parts';

/** Названия банков — собственные имена, поэтому хранятся рядом, а не в словаре. */
const RUSSIAN_BANKS: Record<Language, readonly string[]> = {
  ru: ['Т-Банк', 'СберБанк', 'Альфа-Банк', 'ВТБ'],
  en: ['T-Bank', 'Sberbank', 'Alfa-Bank', 'VTB'],
};

export interface SbpPanelProps {
  plan: Plan;
  rubAmount: number;
  timer: string;
  invoice: SbpInvoice | null;
  loading: boolean;
  copied: boolean;
  onCopyAmount: () => void;
  submitting: boolean;
  feedback: string | null;
  onConfirm: () => void;
}

/** Панель оплаты через СБП: сумма в рублях, QR-код, инструкция и проверка перевода. */
export function SbpPanel({
  plan,
  rubAmount,
  timer,
  invoice,
  loading,
  copied,
  onCopyAmount,
  submitting,
  feedback,
  onConfirm,
}: SbpPanelProps) {
  const { t, language } = useTranslation();

  return (
    <PanelShell
      icon={<SbpIcon className="size-5" />}
      iconClassName="bg-surface-2 ring-stroke"
      title={t('checkout.sbpTitle')}
      lead={t('checkout.sbpLead')}
      aside={<TimerPill label={t('checkout.sbpTimer')} value={timer} />}
    >
      {/* Сумма в рублях */}
      <div className="flex flex-col gap-3 rounded-xl border border-stroke bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[13px] text-muted">{t('checkout.sbpAmountLabel')}</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-[28px] leading-8 font-semibold tracking-tight text-text tabular-nums">
              {rubAmount.toLocaleString('ru-RU')} ₽
            </span>
            <span className="text-xs text-muted tabular-nums">(${plan.priceMonthly})</span>
          </p>
        </div>
        <CopyButton copied={copied} label={t('checkout.sbpCopySum')} onCopy={onCopyAmount} />
      </div>

      {/* QR-код и инструкция */}
      <div className="flex flex-col items-center gap-6 rounded-2xl border border-stroke bg-canvas p-4 md:flex-row md:items-start">
        <QrFrame loading={loading} loadingLabel={t('checkout.sbpGenerating')} skeletonClassName="size-44">
          <QrCode
            value={
              invoice?.qrPayload ||
              `https://qr.nspk.ru/AD10000KETNERAI_${plan.id}?amount=${rubAmount * 100}`
            }
            size={176}
            badge={
              <div className="flex size-8 items-center justify-center rounded-lg bg-white shadow-sm">
                <SbpIcon className="size-5" />
              </div>
            }
          />
        </QrFrame>

        <div className="flex w-full min-w-0 flex-col gap-4 text-left">
          <div>
            <h3 className="text-sm font-semibold text-text">{t('checkout.sbpHowTitle')}</h3>
            <ol className="mt-2.5 flex flex-col gap-2 text-[13px] leading-5 text-muted">
              {[
                t('checkout.sbpStep1'),
                t('checkout.sbpStep2'),
                t('checkout.sbpStep3', { amount: rubAmount }),
              ].map((step, index) => (
                <li key={index} className="flex gap-2.5">
                  <span
                    aria-hidden="true"
                    className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent"
                  >
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="border-t border-stroke pt-3">
            <p className="text-xs font-medium text-muted">{t('checkout.sbpBanks')}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {RUSSIAN_BANKS[language].map((bank) => (
                <li
                  key={bank}
                  className="rounded-lg border border-stroke bg-surface px-2 py-1 text-xs font-medium text-text"
                >
                  {bank}
                </li>
              ))}
              <li className="rounded-lg border border-stroke bg-surface px-2 py-1 text-xs text-muted">
                {t('checkout.sbpMoreBanks')}
              </li>
            </ul>
          </div>
        </div>
      </div>

      <StatusRow status={t('checkout.sbpStatus')} hint={t('checkout.autoCheck')} />

      {feedback ? (
        <Notice tone="warning" live>
          {feedback}
        </Notice>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        {invoice?.deepLink ? (
          <a
            href={invoice.deepLink}
            target="_blank"
            rel="noreferrer"
            className={buttonClasses({ variant: 'primary', size: 'lg', className: 'h-auto min-h-12 flex-1 gap-2 py-3 text-center whitespace-normal' })}
          >
            <SbpIcon className="size-4" />
            <span>{t('checkout.sbpOpenBank')}</span>
          </a>
        ) : null}

        <Button
          type="button"
          variant={invoice?.deepLink ? 'outline' : 'primary'}
          size="lg"
          className={cn('h-auto min-h-12 py-3 whitespace-normal', invoice?.deepLink ? 'flex-1' : 'w-full')}
          aria-label={t('checkout.sbpConfirm')}
          loading={submitting}
          leftIcon={<RefreshIcon className="size-4" />}
          onClick={onConfirm}
        >
          {submitting ? t('checkout.sbpChecking') : t('checkout.sbpCheck')}
        </Button>
      </div>

      <p className="text-center text-xs leading-5 text-muted">
        {t('checkout.sbpNotice')} {t('checkout.sbpInstant')}
      </p>
    </PanelShell>
  );
}
