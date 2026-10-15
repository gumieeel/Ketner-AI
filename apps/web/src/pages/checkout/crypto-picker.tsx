import { useMemo, useState } from 'react';
import { InfoIcon } from '@/components/icons';
import { Input } from '@/components/ui/input';
import type { CryptoCurrency, CryptoFees } from '@/features/billing/types';
import {
  COINS,
  SERVICE_FEE_PERCENT,
  coinOf,
  estimateFees,
  networkOf,
  networksOfCoin,
  type Coin,
  type CryptoNetwork,
} from '@/features/billing/trybit-currencies';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { ChoiceTile, StepLabel, TileTag } from './parts';

function CoinBadge({ coin, className }: { coin: Coin; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('grid size-8 shrink-0 place-items-center rounded-full text-[10px] font-bold tracking-tight text-white', className)}
      style={{ backgroundColor: coin.color }}
    >
      {coin.id.slice(0, 4)}
    </span>
  );
}

const usd = (value: number) => `$${value.toFixed(2)}`;

/** Выбор монеты, затем сети — те же варианты, что на платёжной странице Trybit. */
export function CryptoPicker({ value, onChange }: { value: CryptoCurrency; onChange: (currency: CryptoCurrency) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const selected = coinOf(value);
  const networks = networksOfCoin(selected.id);

  const coins = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle) return COINS.filter((coin) => coin.id.toLowerCase().includes(needle) || coin.name.toLowerCase().includes(needle));
    return showAll ? COINS : COINS.filter((coin) => coin.popular || coin.id === selected.id);
  }, [query, showAll, selected.id]);

  const pickCoin = (coin: Coin) => {
    if (coin.id === selected.id) return;
    // По умолчанию — первая сеть монеты (для USDT это Tron, самая привычная).
    onChange(networksOfCoin(coin.id)[0]!.code);
  };

  return (
    <>
      <div role="group" aria-labelledby="crypto-step-currency" className="flex flex-col gap-2.5">
        <StepLabel
          id="crypto-step-currency"
          title={t('checkout.cryptoStepCurrency')}
          hint={t('checkout.coinCount', { count: COINS.length })}
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('checkout.coinSearch')}
          aria-label={t('checkout.coinSearch')}
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {coins.map((coin) => (
            <ChoiceTile
              key={coin.id}
              selected={coin.id === selected.id}
              onClick={() => pickCoin(coin)}
              className="flex-row items-center gap-2.5 p-2.5"
            >
              <CoinBadge coin={coin} />
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] font-semibold text-text">{coin.id}</span>
                <span className="truncate text-xs text-muted">{coin.name}</span>
              </span>
            </ChoiceTile>
          ))}
        </div>
        {coins.length === 0 ? <p className="text-[13px] text-muted">{t('checkout.coinNone')}</p> : null}
        {!query ? (
          <button
            type="button"
            onClick={() => setShowAll((open) => !open)}
            className="self-start text-[13px] font-medium text-accent underline-offset-2 hover:underline"
          >
            {showAll ? t('checkout.coinLess') : t('checkout.coinMore', { count: COINS.length })}
          </button>
        ) : null}
      </div>

      <div role="group" aria-labelledby="crypto-step-network" className="flex flex-col gap-2.5">
        <StepLabel
          id="crypto-step-network"
          title={`2. ${t('checkout.cryptoNetwork')}`}
          hint={t('checkout.cryptoStepNetworkHint')}
        />
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {networks.map((item) => (
            <NetworkTile key={item.code} item={item} selected={item.code === value} onSelect={() => onChange(item.code)} />
          ))}
        </div>
      </div>
    </>
  );
}

function NetworkTile({ item, selected, onSelect }: { item: CryptoNetwork; selected: boolean; onSelect: () => void }) {
  const { t } = useTranslation();
  return (
    <ChoiceTile selected={selected} onClick={onSelect} className="flex-row items-center justify-between gap-3">
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px] font-semibold text-text">
          {item.coin} · {item.network}
        </span>
        <span className="text-xs text-muted">
          {item.transferFee === 'fixed'
            ? t('checkout.feeTransferTron')
            : item.transferFee === 'dynamic'
              ? t('checkout.feeTransferDynamic')
              : t('checkout.feeTransferNone')}
        </span>
      </span>
      {item.transferFee === 'none' ? <TileTag tone="brand">{t('checkout.feeNoExtra')}</TileTag> : null}
    </ChoiceTile>
  );
}

/** Состав суммы: цена тарифа и комиссии Trybit — точные из счёта или оценка до его выставления. */
export function CryptoFeeBreakdown({
  priceUsd,
  currency,
  fees,
  loading,
}: {
  priceUsd: number;
  currency: CryptoCurrency;
  fees?: CryptoFees;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const network = networkOf(currency);
  const estimate = estimateFees(priceUsd, network.transferFee);

  const rows: { label: string; value: string; strong?: boolean }[] = [{ label: t('checkout.feePlan'), value: usd(priceUsd) }];
  let note: string;
  if (fees && !loading) {
    if (fees.payerUsd > 0) {
      rows.push({ label: t('checkout.feeTrybit'), value: `+ ${usd(fees.payerUsd)}` });
      rows.push({ label: t('checkout.feeTotal'), value: usd(fees.totalUsd), strong: true });
      note = t('checkout.feeNotePayer', { service: usd(fees.serviceUsd), transfer: usd(fees.transferUsd) });
    } else {
      rows.push({ label: t('checkout.feeTotal'), value: usd(priceUsd), strong: true });
      note = t('checkout.feeNoteMerchant', { service: usd(fees.serviceUsd), transfer: usd(fees.transferUsd) });
    }
  } else {
    rows.push({ label: t('checkout.feeService', { percent: SERVICE_FEE_PERCENT }), value: `≈ ${usd(estimate.serviceUsd)}` });
    rows.push({
      label: t('checkout.feeTransfer'),
      value: estimate.transferUsd === null ? t('checkout.feeDynamic') : `≈ ${usd(estimate.transferUsd)}`,
    });
    note = t('checkout.feeNoteEstimate');
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-stroke bg-canvas/70 p-3.5">
      <StepLabel title={t('checkout.feeTitle')} hint={fees && !loading ? t('checkout.feeExact') : t('checkout.feeEstimate')} />
      <dl className="flex flex-col gap-1.5 text-[13px]">
        {rows.map((row) => (
          <div key={row.label} className={cn('flex items-baseline justify-between gap-3', row.strong && 'border-t border-stroke pt-2 font-semibold text-text')}>
            <dt className={row.strong ? undefined : 'text-muted'}>{row.label}</dt>
            <dd className="tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="flex items-start gap-2 text-xs leading-5 text-muted">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-info" />
        <span>
          {note} {t('checkout.feeNetwork')}
        </span>
      </p>
    </div>
  );
}
