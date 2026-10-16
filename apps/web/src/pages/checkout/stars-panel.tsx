import { RefreshIcon, StarIcon, TelegramIcon } from '@/components/icons';
import { Callout } from '@/components/docs/callout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { QrCode } from '@/components/ui/qr-code';
import { useTranslation } from '@/i18n';
import { Notice, PanelShell, QrFrame, StatusRow } from './parts';

export interface StarsPanelProps {
  /** Подпись под суммой: за что и на какой срок платёж. */
  periodNotice: string;
  /** Сумма в звёздах; null — счёт ещё готовится. */
  starsAmount: number | null;
  /** Сколько эти звёзды стоят по официальному курсу Telegram, $. */
  starsUsd: number | null;
  /** Официальный курс Telegram, $ за звезду (приходит со счётом). */
  usdPerStar: number | null;
  /** Цена картой или криптой — для сравнения. */
  cardPriceUsd: number;
  botUsername: string;
  botDeepLink: string;
  loading: boolean;
  submitting: boolean;
  feedback: string | null;
  onConfirm: () => void;
}

/** Цена в звёздах округляется до 10 ⭐ (≈ $0.20): разница меньше этой — не «дороже». */
const STARS_ROUNDING_USD = 0.25;

/** Панель оплаты Telegram Stars: сумма в звёздах, QR на бота и проверка счёта. */
export function StarsPanel({
  periodNotice,
  starsAmount,
  starsUsd,
  usdPerStar,
  cardPriceUsd,
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
          <span className="text-4xl font-semibold tracking-tight tabular-nums">
            {starsAmount ?? '…'}
          </span>
          <span className="text-xl text-muted">Stars</span>
        </p>
        <p className="text-[13px] text-muted">{periodNotice}</p>
        {starsUsd !== null ? (
          <p className="text-[13px] text-muted">
            {usdPerStar
              ? t('checkout.starsUsdRate', {
                  usd: starsUsd.toFixed(2),
                  per1000: (usdPerStar * 1000).toFixed(2),
                })
              : t('checkout.starsUsd', { usd: starsUsd.toFixed(2) })}
          </p>
        ) : null}
        {starsUsd !== null && starsUsd - cardPriceUsd > STARS_ROUNDING_USD ? (
          <p className="text-[12px] leading-5 text-subtle">
            {t('checkout.starsDearer', { price: `$${cardPriceUsd}` })}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col items-center gap-3">
        <p className="text-[13px] font-medium text-muted">{t('checkout.starsQrHint')}</p>
        <QrFrame
          loading={loading}
          loadingLabel={t('checkout.starsPreparing')}
          skeletonClassName="size-40"
        >
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
