import { BitcoinIcon, TonIcon, UsdtIcon } from '@/components/icons';
import type { CryptoCurrency } from '@/features/billing/types';

export interface CryptoOption {
  id: CryptoCurrency;
  name: string;
  network: string;
  icon: typeof UsdtIcon;
  calcAmount: (usd: number) => number;
  formatAmount: (usd: number) => string;
}

/** Поддерживаемые валюты и сети: курс и формат суммы (адрес для оплаты выдаёт Trybit). */
export const CRYPTO_OPTIONS: readonly CryptoOption[] = [
  {
    id: 'USDT_TRC20',
    name: 'USDT (TRC-20)',
    network: 'TRC-20 (Tron)',
    icon: UsdtIcon,
    calcAmount: (usd) => usd,
    formatAmount: (usd) => `${usd.toFixed(2)} USDT`,
  },
  {
    id: 'USDT_TON',
    name: 'USDT (TON)',
    network: 'TON Network',
    icon: TonIcon,
    calcAmount: (usd) => usd,
    formatAmount: (usd) => `${usd.toFixed(2)} USDT`,
  },
  {
    id: 'TON',
    name: 'TON',
    network: 'The Open Network',
    icon: TonIcon,
    calcAmount: (usd) => +(usd / 5.4).toFixed(2),
    formatAmount: (usd) => `${(usd / 5.4).toFixed(2)} TON`,
  },
  {
    id: 'BTC',
    name: 'Bitcoin',
    network: 'Bitcoin',
    icon: BitcoinIcon,
    calcAmount: (usd) => +(usd / 95000).toFixed(6),
    formatAmount: (usd) => `${(usd / 95000).toFixed(6)} BTC`,
  },
];
