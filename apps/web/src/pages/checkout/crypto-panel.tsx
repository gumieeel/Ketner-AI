import {
  AlertIcon,
  BitcoinIcon,
  CheckIcon,
  CryptoIcon,
  ExternalLinkIcon,
  InfoIcon,
  RefreshIcon,
  ShieldIcon,
  TonIcon,
  UsdtIcon,
} from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { Input } from '@/components/ui/input';
import { QrCode } from '@/components/ui/qr-code';
import { RichText } from '@/components/ui/rich-text';
import type { CryptoCurrency, CryptoInvoice, Plan } from '@/features/billing/types';
import { useTranslation } from '@/i18n';
import type { CryptoOption } from './crypto-options';
import {
  ChoiceTile,
  CopyButton,
  Notice,
  PanelShell,
  QrFrame,
  StatusRow,
  StepLabel,
  TileTag,
  TimerPill,
} from './parts';

export type CryptoTransferMode = 'gateway' | 'manual';

export interface CryptoPanelProps {
  plan: Plan;
  planName: string;
  amount: string;
  timer: string;
  currency: CryptoCurrency;
  onCurrencyChange: (currency: CryptoCurrency) => void;
  mode: CryptoTransferMode;
  onModeChange: (mode: CryptoTransferMode) => void;
  payerEmail: string;
  onPayerEmailChange: (email: string) => void;
  sendReceipt: boolean;
  onSendReceiptChange: (value: boolean) => void;
  gatewayOpened: boolean;
  onGatewayOpen: () => void;
  invoice: CryptoInvoice | null;
  loading: boolean;
  option: CryptoOption;
  address: string;
  qr: string;
  copiedAddress: boolean;
  copiedAmount: boolean;
  onCopyAddress: () => void;
  onCopyAmount: () => void;
  txHash: string;
  onTxHashChange: (value: string) => void;
  submitting: boolean;
  feedback: string | null;
  onConfirm: () => void;
}

/** Панель оплаты криптовалютой: шлюз Trybit или прямой перевод с TxID. */
export function CryptoPanel(props: CryptoPanelProps) {
  const {
    plan,
    planName,
    amount,
    timer,
    currency,
    onCurrencyChange,
    mode,
    onModeChange,
    payerEmail,
    onPayerEmailChange,
    sendReceipt,
    onSendReceiptChange,
    invoice,
  } = props;
  const { t } = useTranslation();
  const isUsdt = currency.startsWith('USDT');
  const invoiceNo =
    invoice?.cryptoCloudInvoiceId || (invoice ? `INV-${invoice.id.slice(0, 8).toUpperCase()}` : 'INV-AI');

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
            <img src="/logo-mark-160.png" alt="" width={36} height={36} className="size-9 shrink-0 rounded-xl" />
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

        {/* 1. Валюта */}
        <div role="group" aria-labelledby="crypto-step-currency" className="flex flex-col gap-2.5">
          <StepLabel id="crypto-step-currency" title={t('checkout.cryptoStepCurrency')} hint={t('checkout.cryptoStepCurrencyHint')} />
          <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
            <ChoiceTile selected={isUsdt} onClick={() => onCurrencyChange('USDT_TRC20')}>
              <span className="flex w-full items-center justify-between gap-1">
                <UsdtIcon className="size-5" />
                <TileTag selected={isUsdt}>{t('checkout.cryptoTop')}</TileTag>
              </span>
              <span className="mt-1 text-[13px] font-semibold text-text">USDT</span>
              <span className="text-xs text-muted">Tether USD</span>
            </ChoiceTile>
            <ChoiceTile selected={currency === 'TON'} onClick={() => onCurrencyChange('TON')}>
              <span className="flex w-full items-center justify-between gap-1">
                <TonIcon className="size-5" />
                <span className="max-sm:hidden">
                  <TileTag selected={currency === 'TON'}>Telegram</TileTag>
                </span>
              </span>
              <span className="mt-1 text-[13px] font-semibold text-text">TON</span>
              <span className="text-xs text-muted">The Open Network</span>
            </ChoiceTile>
            <ChoiceTile selected={currency === 'BTC'} onClick={() => onCurrencyChange('BTC')}>
              <span className="flex w-full items-center justify-between gap-1">
                <BitcoinIcon className="size-5" />
                <span className="max-sm:hidden">
                  <TileTag selected={currency === 'BTC'}>Mainnet</TileTag>
                </span>
              </span>
              <span className="mt-1 text-[13px] font-semibold text-text">Bitcoin</span>
              <span className="text-xs text-muted">BTC Network</span>
            </ChoiceTile>
          </div>
        </div>

        {/* 2. Сеть */}
        <div role="group" aria-labelledby="crypto-step-network" className="flex flex-col gap-2.5">
          <StepLabel id="crypto-step-network" title={`2. ${t('checkout.cryptoNetwork')}`} hint={t('checkout.cryptoStepNetworkHint')} />

          {isUsdt ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <ChoiceTile
                selected={currency === 'USDT_TRC20'}
                onClick={() => onCurrencyChange('USDT_TRC20')}
                className="flex-row items-center justify-between gap-3"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-[13px] font-semibold text-text">USDT (TRC-20)</span>
                  <span className="text-xs text-muted">{t('checkout.cryptoTronHint')}</span>
                </span>
                <TileTag tone="brand">{t('checkout.cryptoFast')}</TileTag>
              </ChoiceTile>
              <ChoiceTile
                selected={currency === 'USDT_TON'}
                onClick={() => onCurrencyChange('USDT_TON')}
                className="flex-row items-center justify-between gap-3"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-[13px] font-semibold text-text">USDT (TON)</span>
                  <span className="text-xs text-muted">{t('checkout.cryptoTonUsdtHint')}</span>
                </span>
                <TileTag>~$0.05</TileTag>
              </ChoiceTile>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-accent bg-accent-soft p-3">
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] font-semibold text-text">
                  {currency === 'TON' ? 'The Open Network (TON)' : 'Bitcoin Mainnet (BTC)'}
                </span>
                <span className="text-xs text-muted">
                  {currency === 'TON' ? t('checkout.cryptoTonHint') : t('checkout.cryptoBtcHint')}
                </span>
              </span>
              <TileTag tone="brand">{t('checkout.cryptoActive')}</TileTag>
            </div>
          )}
        </div>

        {/* 3. Способ проведения оплаты */}
        <div role="group" aria-labelledby="crypto-step-mode" className="flex flex-col gap-2.5">
          <StepLabel id="crypto-step-mode" title={t('checkout.cryptoStepMode')} />
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <ChoiceTile selected={mode === 'gateway'} onClick={() => onModeChange('gateway')} className="p-3.5">
              <span className="flex w-full items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-text">Trybit</span>
                <TileTag selected={mode === 'gateway'}>{t('checkout.tileCryptoBadge')}</TileTag>
              </span>
              <span className="mt-0.5 text-xs leading-5 text-muted">{t('checkout.cryptoModeGatewayDesc')}</span>
            </ChoiceTile>
            <ChoiceTile selected={mode === 'manual'} onClick={() => onModeChange('manual')} className="p-3.5">
              <span className="flex w-full items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-text">{t('checkout.cryptoModeManual')}</span>
                <TileTag selected={mode === 'manual'}>{t('checkout.cryptoModeManualBadge')}</TileTag>
              </span>
              <span className="mt-0.5 text-xs leading-5 text-muted">{t('checkout.cryptoModeManualDesc')}</span>
            </ChoiceTile>
          </div>
        </div>

        {/* Email для чека */}
        <div className="flex flex-col gap-2.5 rounded-xl border border-stroke bg-canvas/70 p-3.5">
          <StepLabel htmlFor="payer-email-crypto" title={t('checkout.receiptEmail')} hint={t('checkout.receiptEmailHint')} />
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

        {mode === 'gateway' ? <GatewayBlock {...props} /> : <ManualBlock {...props} />}
      </div>
    </PanelShell>
  );
}

/** Вариант 1: оплата через шлюз Trybit. */
function GatewayBlock({
  amount,
  address,
  invoice,
  loading,
  gatewayOpened,
  onGatewayOpen,
  submitting,
  feedback,
  onConfirm,
}: CryptoPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 rounded-xl border border-stroke bg-surface-2 px-3.5 py-3 text-[13px] sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <span className="shrink-0 text-muted">{t('checkout.cryptoOfficialWallet')}</span>
        <span className="font-mono text-xs font-semibold break-all text-text select-all">{address}</span>
      </div>

      {invoice?.cryptoCloudUrl ? (
        <a
          href={invoice.cryptoCloudUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onGatewayOpen}
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

      <StatusRow status={t('checkout.cryptoGatewayStatus')} hint={t('checkout.autoCheck')} dotClassName="bg-accent">
        <p className="text-xs leading-5 text-muted">{t('checkout.cryptoGatewayInfo')}</p>
      </StatusRow>

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
    </div>
  );
}

/** Вариант 2: прямой перевод на кошелёк с проверкой TxID. */
function ManualBlock({
  amount,
  option,
  address,
  qr,
  loading,
  copiedAddress,
  copiedAmount,
  onCopyAddress,
  onCopyAmount,
  txHash,
  onTxHashChange,
  submitting,
  feedback,
  onConfirm,
}: CryptoPanelProps) {
  const { t } = useTranslation();
  const OptionIcon = option.icon;

  return (
    <div className="flex flex-col gap-4 border-t border-stroke pt-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col justify-between gap-2 rounded-xl border border-stroke bg-surface-2 p-3.5">
          <span className="text-[13px] text-muted">{t('checkout.cryptoAmount')}</span>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xl font-semibold text-accent tabular-nums">{amount}</span>
            <CopyButton variant="ghost" copied={copiedAmount} label={t('checkout.cryptoCopyAmount')} onCopy={onCopyAmount} />
          </div>
        </div>

        <div className="flex flex-col justify-between gap-2 rounded-xl border border-stroke bg-surface-2 p-3.5">
          <span className="text-[13px] text-muted">{t('checkout.cryptoSelectedNetwork')}</span>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-text">{option.network}</span>
            <Badge tone="brand" className="px-2 py-0 text-[11px]">
              {t('checkout.cryptoOneConfirmation')}
            </Badge>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 rounded-xl border border-stroke bg-canvas p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-text">{t('checkout.cryptoAddress')}</span>
          <CopyButton copied={copiedAddress} label={t('checkout.cryptoCopyAddress')} onCopy={onCopyAddress} />
        </div>
        <div className="rounded-lg border border-stroke bg-surface-2 p-2.5 font-mono text-xs font-semibold break-all text-text select-all">
          {address}
        </div>
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
          <p className="text-[13px] leading-5 text-muted">{t('checkout.cryptoWallets')}</p>
          <p className="flex items-start gap-2 text-[13px] leading-5 font-medium text-text">
            <AlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>{t('checkout.cryptoWrongNetwork')}</span>
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 rounded-xl border border-accent/30 bg-canvas p-4">
        <StepLabel htmlFor="crypto-tx-hash" title={t('checkout.cryptoTxHash')} hint={t('checkout.cryptoTxRequired')} />
        <Input
          id="crypto-tx-hash"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('checkout.cryptoTxHashPlaceholder')}
          value={txHash}
          onChange={(e) => onTxHashChange(e.target.value)}
          className="font-mono text-sm md:text-sm"
        />
        <p className="text-xs leading-5 text-muted">{t('checkout.cryptoVerifier')}</p>
      </div>

      {feedback ? (
        <Notice tone="warning" live>
          {feedback}
        </Notice>
      ) : null}

      <Button
        type="button"
        variant="primary"
        size="lg"
        fullWidth
        className="h-auto min-h-12 py-3 whitespace-normal"
        aria-label={t('checkout.cryptoConfirm')}
        loading={submitting}
        leftIcon={<CheckIcon className="size-4" />}
        onClick={onConfirm}
      >
        {submitting ? t('checkout.cryptoChecking') : t('checkout.cryptoPaidConfirm')}
      </Button>

    </div>
  );
}
