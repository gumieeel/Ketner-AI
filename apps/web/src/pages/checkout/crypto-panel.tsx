import {
  AlertIcon,
  CryptoIcon,
  ExternalLinkIcon,
  InfoIcon,
  RefreshIcon,
  ShieldIcon,
} from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { Input } from '@/components/ui/input';
import { QrCode } from '@/components/ui/qr-code';
import { RichText } from '@/components/ui/rich-text';
import type { CryptoCurrency, CryptoInvoice, Plan } from '@/features/billing/types';
import { useTranslation } from '@/i18n';
import { CryptoFeeBreakdown, CryptoPicker } from './crypto-picker';
import type { CryptoOption } from './crypto-options';
import { openGatewayWindow } from './gateway-window';
import { CopyButton, Notice, PanelShell, QrFrame, StatusRow, StepLabel, TimerPill } from './parts';

export interface CryptoPanelProps {
  plan: Plan;
  planName: string;
  amount: string;
  timer: string;
  currency: CryptoCurrency;
  onCurrencyChange: (currency: CryptoCurrency) => void;
  payerEmail: string;
  onPayerEmailChange: (email: string) => void;
  sendReceipt: boolean;
  onSendReceiptChange: (value: boolean) => void;
  gatewayOpened: boolean;
  onGatewayOpen: () => void;
  invoice: CryptoInvoice | null;
  loading: boolean;
  /** Trybit не выставил счёт — показываем причину и кнопку повтора. */
  invoiceError: string | null;
  onRetryInvoice: () => void;
  option: CryptoOption;
  address: string;
  qr: string;
  copiedAddress: boolean;
  copiedAmount: boolean;
  onCopyAddress: () => void;
  onCopyAmount: () => void;
  submitting: boolean;
  feedback: string | null;
  onConfirm: () => void;
}

/** Панель оплаты криптовалютой: только через Trybit — реквизиты и проверка оплаты от шлюза. */
export function CryptoPanel(props: CryptoPanelProps) {
  const {
    plan,
    planName,
    amount,
    timer,
    currency,
    onCurrencyChange,
    payerEmail,
    onPayerEmailChange,
    sendReceipt,
    onSendReceiptChange,
    invoice,
  } = props;
  const { t } = useTranslation();
  const invoiceNo =
    invoice?.cryptoCloudInvoiceId ||
    (invoice ? `INV-${invoice.id.slice(0, 8).toUpperCase()}` : 'INV-AI');

  return (
    <PanelShell
      icon={<CryptoIcon className="size-5" />}
      title={t('checkout.cryptoTitle')}
      lead={t('checkout.cryptoLead')}
      aside={<TimerPill label={t('checkout.cryptoTimer')} value={timer} />}
    >
      <div className="relative flex flex-col gap-6 overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-b from-accent-soft via-surface to-surface p-3.5 sm:p-6">
        {/* Шапка счёта */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stroke pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src="/logo-mark-160.png"
              alt=""
              width={36}
              height={36}
              className="size-9 shrink-0 rounded-xl"
            />
            <div className="min-w-0">
              <p className="text-sm leading-tight font-semibold text-text">Ketner AI</p>
              <p className="mt-0.5 truncate font-mono text-xs text-muted">
                {t('checkout.cryptoInvoiceNo', { id: invoiceNo })}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="success" className="gap-1 px-2 py-0 text-[11px] font-semibold">
              <ShieldIcon className="size-3" />
              {t('checkout.cryptoSecure')}
            </Badge>
            <Badge tone="neutral" className="px-2 py-0 text-[11px]">
              Trybit
            </Badge>
          </div>
        </div>

        {/* Сумма */}
        <div className="flex flex-col gap-3 rounded-xl border border-stroke bg-canvas/70 p-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-[13px] text-muted">{t('checkout.cryptoDue')}</p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className="text-[28px] leading-9 font-semibold tracking-tight text-text tabular-nums sm:text-3xl">
                {amount}
              </span>
              <span className="text-xs text-muted tabular-nums">≈ ${plan.priceMonthly}.00 USD</span>
            </p>
          </div>
          <Badge tone="brand" className="self-start sm:self-auto">
            {t('checkout.cryptoPlanChip', { plan: planName })}
          </Badge>
        </div>

        {/* 1–2. Монета и сеть — как на платёжной странице Trybit */}
        <CryptoPicker value={currency} onChange={onCurrencyChange} />

        <CryptoFeeBreakdown
          priceUsd={plan.priceMonthly}
          currency={currency}
          fees={invoice?.fees}
          loading={props.loading}
        />

        {/* Email для чека */}
        <div className="flex flex-col gap-2.5 rounded-xl border border-stroke bg-canvas/70 p-3.5">
          <StepLabel
            htmlFor="payer-email-crypto"
            title={t('checkout.receiptEmail')}
            hint={t('checkout.receiptEmailHint')}
          />
          <Input
            id="payer-email-crypto"
            type="email"
            autoComplete="email"
            value={payerEmail}
            onChange={(e) => onPayerEmailChange(e.target.value)}
            placeholder="user@example.com"
          />
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 select-none md:min-h-9">
            <input
              type="checkbox"
              checked={sendReceipt}
              onChange={(e) => onSendReceiptChange(e.target.checked)}
              className="size-4 shrink-0 accent-accent"
            />
            <span className="text-[13px] text-muted">{t('checkout.receiptSend')}</span>
          </label>
        </div>

        <GatewayBlock {...props} />
      </div>
    </PanelShell>
  );
}

/** Вариант 1: оплата через шлюз Trybit. */
function GatewayBlock(props: CryptoPanelProps) {
  const {
    amount,
    invoice,
    loading,
    invoiceError,
    onRetryInvoice,
    gatewayOpened,
    onGatewayOpen,
    submitting,
    feedback,
    onConfirm,
  } = props;
  const { t } = useTranslation();

  if (invoiceError && !invoice) {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="warning" live>
          {invoiceError}
        </Notice>
        <Button
          type="button"
          variant="primary"
          size="lg"
          fullWidth
          leftIcon={<RefreshIcon className="size-4" />}
          onClick={onRetryInvoice}
        >
          {t('checkout.cryptoInvoiceRetry')}
        </Button>
      </div>
    );
  }

  // Есть ссылка на платёжную страницу Trybit — открываем виджет окном. Только адрес без ссылки — показываем реквизиты на сайте.
  if (invoice?.gatewayDetails && !invoice.cryptoCloudUrl) return <GatewayInlineBlock {...props} />;

  return (
    <div className="flex flex-col gap-4">
      {invoice?.cryptoCloudUrl ? (
        <a
          href={invoice.cryptoCloudUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            event.preventDefault();
            openGatewayWindow(invoice.cryptoCloudUrl as string);
            onGatewayOpen();
          }}
          className={buttonClasses({
            variant: 'primary',
            size: 'lg',
            fullWidth: true,
            className: 'h-auto min-h-12 gap-2.5 py-3 text-center whitespace-normal',
          })}
        >
          <ShieldIcon className="size-4 shrink-0" />
          <span>{t('checkout.cryptoOpenGateway', { amount })}</span>
          <ExternalLinkIcon className="size-4 shrink-0" />
        </a>
      ) : (
        <Button
          type="button"
          variant="primary"
          size="lg"
          fullWidth
          className="h-auto min-h-12 py-3 whitespace-normal"
          loading={loading}
          onClick={onConfirm}
        >
          {loading ? t('checkout.cryptoCreatingInvoice') : t('checkout.cryptoGoToPay', { amount })}
        </Button>
      )}

      <p className="flex items-start justify-center gap-2 text-center text-xs leading-5 text-muted">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-info" />
        <span>
          <RichText text={t('checkout.cryptoGatewayHint')} />
        </span>
      </p>

      {gatewayOpened ? (
        <Notice
          tone="success"
          live
          action={
            invoice?.cryptoCloudUrl ? (
              <a
                href={invoice.cryptoCloudUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => {
                  event.preventDefault();
                  openGatewayWindow(invoice.cryptoCloudUrl as string);
                }}
                className="shrink-0 font-semibold text-accent underline underline-offset-2 hover:opacity-80"
              >
                {t('checkout.cryptoReopen')}
              </a>
            ) : null
          }
        >
          {t('checkout.cryptoGatewayOpened')}
        </Notice>
      ) : null}

      <StatusRow
        status={t('checkout.cryptoGatewayStatus')}
        hint={t('checkout.autoCheck')}
        dotClassName="bg-accent"
      >
        <p className="text-xs leading-5 text-muted">{t('checkout.cryptoGatewayInfo')}</p>
      </StatusRow>

      <CheckBlock feedback={feedback} submitting={submitting} onConfirm={onConfirm} />
    </div>
  );
}

/** Оплата на сайте по реквизитам Trybit (H2H): сумма, сеть, адрес, QR и автоматическая проверка. */
function GatewayInlineBlock({
  amount,
  option,
  address,
  qr,
  invoice,
  loading,
  copiedAddress,
  copiedAmount,
  onCopyAddress,
  onCopyAmount,
  submitting,
  feedback,
  onConfirm,
}: CryptoPanelProps) {
  const { t } = useTranslation();
  const OptionIcon = option.icon;
  const memo = invoice?.memo;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col justify-between gap-2 rounded-xl border border-stroke bg-surface-2 p-3.5">
          <span className="text-[13px] text-muted">{t('checkout.cryptoAmountExact')}</span>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xl font-semibold text-accent tabular-nums">{amount}</span>
            <CopyButton
              variant="ghost"
              copied={copiedAmount}
              label={t('checkout.cryptoCopyAmount')}
              onCopy={onCopyAmount}
            />
          </div>
        </div>
        <div className="flex flex-col justify-between gap-2 rounded-xl border border-stroke bg-surface-2 p-3.5">
          <span className="text-[13px] text-muted">{t('checkout.cryptoSelectedNetwork')}</span>
          <span className="text-sm font-semibold text-text">
            {invoice?.network || option.network}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 rounded-xl border border-stroke bg-canvas p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-text">{t('checkout.cryptoAddress')}</span>
          <CopyButton
            copied={copiedAddress}
            label={t('checkout.cryptoCopyAddress')}
            onCopy={onCopyAddress}
          />
        </div>
        <div className="rounded-lg border border-stroke bg-surface-2 p-2.5 font-mono text-xs font-semibold break-all text-text select-all">
          {address}
        </div>
        {memo ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-text">{t('checkout.cryptoMemo')}</span>
            <div className="rounded-lg border border-warning/40 bg-surface-2 p-2.5 font-mono text-xs font-semibold break-all text-text select-all">
              {memo}
            </div>
            <p className="text-xs leading-5 text-muted">{t('checkout.cryptoMemoHint')}</p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col items-center gap-5 rounded-xl border border-stroke bg-surface-2 p-4 sm:flex-row sm:items-start">
        <QrFrame loading={loading} loadingLabel={t('common.loading')} skeletonClassName="size-36">
          <QrCode
            value={qr}
            size={144}
            badge={
              <div className="flex size-6 items-center justify-center rounded-md bg-white shadow-xs">
                <OptionIcon className="size-4" />
              </div>
            }
          />
        </QrFrame>
        <div className="flex min-w-0 flex-col gap-2 text-left">
          <h3 className="text-sm font-semibold text-text">{t('checkout.cryptoScanQr')}</h3>
          <p className="text-[13px] leading-5 text-muted">{t('checkout.cryptoInlineHint')}</p>
          <p className="flex items-start gap-2 text-[13px] leading-5 font-medium text-text">
            <AlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>{t('checkout.cryptoWrongNetwork')}</span>
          </p>
        </div>
      </div>

      <StatusRow
        status={t('checkout.cryptoInlineStatus')}
        hint={t('checkout.autoCheck')}
        dotClassName="bg-accent"
      >
        <p className="text-xs leading-5 text-muted">{t('checkout.cryptoGatewayInfo')}</p>
      </StatusRow>

      <CheckBlock feedback={feedback} submitting={submitting} onConfirm={onConfirm} />
    </div>
  );
}

/** Подсказка и кнопка ручной проверки оплаты (проверка идёт и сама каждые несколько секунд). */
function CheckBlock({
  feedback,
  submitting,
  onConfirm,
}: Pick<CryptoPanelProps, 'feedback' | 'submitting' | 'onConfirm'>) {
  const { t } = useTranslation();
  return (
    <>
      {feedback ? (
        <Notice tone="warning" live>
          {feedback}
        </Notice>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="lg"
        fullWidth
        className="h-auto min-h-12 py-3 whitespace-normal"
        aria-label={t('checkout.cryptoConfirm')}
        loading={submitting}
        leftIcon={<RefreshIcon className="size-4" />}
        onClick={onConfirm}
      >
        {submitting ? t('checkout.cryptoChecking') : t('checkout.cryptoCheck')}
      </Button>
    </>
  );
}
