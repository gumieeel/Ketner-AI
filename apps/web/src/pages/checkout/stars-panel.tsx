import { RefreshIcon, StarIcon, TelegramIcon } from '@/components/icons';
import { Callout } from '@/components/docs/callout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { QrCode } from '@/components/ui/qr-code';
import type { Plan } from '@/features/billing/types';
import { useTranslation } from '@/i18n';
import { Notice, PanelShell, QrFrame, StatusRow } from './parts';

export interface StarsPanelProps {
  plan: Plan;
  planName: string;
  starsAmount: number;
  botUsername: string;
  botDeepLink: string;
  loading: boolean;
  submitting: boolean;
  feedback: string | null;
  onConfirm: () => void;
}

/** Панель оплаты Telegram Stars: сумма в звёздах, QR на бота и проверка счёта. */
export function StarsPanel({
  plan,
  planName,
  starsAmount,
  botUsername,
  botDeepLink,
  loading,
  submitting,
  feedback,
  onConfirm,
}: StarsPanelProps) {
  const { t } = useTranslation();

  return (
    <PanelShell
      icon={<StarIcon className="size-5 fill-warning" />}
      iconClassName="bg-warning-soft text-warning ring-warning/25"
      title={t('checkout.starsTitle')}
      lead={t('checkout.starsLead')}
      aside={
        <Badge tone="brand" className="self-start sm:self-auto">
          {t('checkout.starsBadge')}
        </Badge>
      }
    >
      <Callout tone="info" title={t('checkout.starsOfficial')} className="my-0 text-left">
        {t('checkout.starsNotice')}
      </Callout>

      <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-warning/25 bg-gradient-to-b from-warning-soft via-surface-2 to-surface-2 p-6 text-center">
        <p className="flex items-center justify-center gap-2.5 text-warning">
          <StarIcon aria-hidden="true" className="size-8 fill-warning" />
          <span className="text-4xl font-semibold tracking-tight tabular-nums">{starsAmount}</span>
          <span className="text-xl text-muted">Stars</span>
        </p>
        <p className="text-[13px] text-muted">
          {t('checkout.starsPeriodNotice', { price: `$${plan.priceMonthly}`, plan: planName })}
        </p>
      </div>

      <div className="flex flex-col items-center gap-3">
        <p className="text-[13px] font-medium text-muted">{t('checkout.starsQrHint')}</p>
        <QrFrame loading={loading} loadingLabel={t('checkout.starsPreparing')} skeletonClassName="size-40">
          <QrCode
            value={botDeepLink}
            size={160}
            badge={
              <div className="flex size-8 items-center justify-center rounded-xl bg-[#24A1DE] text-white shadow-xs">
                <TelegramIcon className="size-5" />
              </div>
            }
          />
        </QrFrame>
      </div>

      <StatusRow status={t('checkout.starsStatus')} hint={t('checkout.starsSync')} />

      {feedback ? (
        <Notice tone="warning" live>
          {feedback}
        </Notice>
      ) : null}

      <div className="flex w-full flex-col gap-3">
        <a
          href={botDeepLink}
          target="_blank"
          rel="noreferrer"
          className={buttonClasses({
            variant: 'primary',
            size: 'lg',
            fullWidth: true,
            className: 'h-auto min-h-12 gap-2 py-3 text-center whitespace-normal',
          })}
        >
          <TelegramIcon className="size-5 shrink-0" />
          <span>{t('checkout.starsPayIn', { bot: botUsername })}</span>
        </a>

        <Button
          type="button"
          variant="outline"
          size="lg"
          fullWidth
          className="h-auto min-h-12 py-3 whitespace-normal"
          aria-label={t('checkout.starsConfirm')}
          loading={submitting}
          leftIcon={<RefreshIcon className="size-4" />}
          onClick={onConfirm}
        >
          {submitting ? t('checkout.starsChecking') : t('checkout.starsCheck')}
        </Button>
      </div>
    </PanelShell>
  );
}
