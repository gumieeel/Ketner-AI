import { BitcoinIcon, CryptoIcon, TonIcon, UsdtIcon } from '@/components/icons';
import type { CryptoCurrency } from '@/features/billing/types';
import { coinOf, networkOf } from '@/features/billing/trybit-currencies';

export interface CryptoOption {
  id: CryptoCurrency;
  name: string;
  network: string;
  icon: typeof UsdtIcon;
  /** Тикер монеты для подписи суммы. */
  ticker: string;
  /** Сумма в монете до выставления счёта: известна только у стейблкоинов (1 монета ≈ 1 $). */
  calcAmount: (usd: number) => number | null;
  formatAmount: (usd: number) => string;
}

const ICONS: Record<string, typeof UsdtIcon> = { USDT: UsdtIcon, BTC: BitcoinIcon, TON: TonIcon };

/** Описание выбранной монеты и сети. Курс не гадаем: точную сумму в монете называет Trybit в счёте. */
export function cryptoOption(id: CryptoCurrency): CryptoOption {
  const network = networkOf(id);
  const coin = coinOf(id);
  const stable = Boolean(coin.stable);
  return {
    id,
    name: `${coin.id} · ${network.network}`,
    network: network.network,
    icon: ICONS[coin.id] ?? CryptoIcon,
    ticker: coin.id,
    calcAmount: (usd) => (stable ? usd : null),
    formatAmount: (usd) => (stable ? `${usd.toFixed(2)} ${coin.id}` : `≈ $${usd.toFixed(2)}`),
  };
}
