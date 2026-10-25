import { BitcoinIcon, TonIcon, UsdtIcon } from '@/components/icons';
import type { CryptoCurrency } from '@/features/billing/types';

export interface CryptoOption {
  id: CryptoCurrency;
  name: string;
  network: string;
  icon: typeof UsdtIcon;
  calcAmount: (usd: number) => number;
  formatAmount: (usd: number) => string;
  defaultAddress: string;
}

/** Поддерживаемые валюты и сети: курс, формат суммы и адрес по умолчанию. */
export const CRYPTO_OPTIONS: readonly CryptoOption[] = [
  {
    id: 'USDT_TRC20',
    name: 'USDT (TRC-20)',
    network: 'TRC-20 (Tron)',
    icon: UsdtIcon,
    calcAmount: (usd) => usd,
    formatAmount: (usd) => `${usd.toFixed(2)} USDT`,
    defaultAddress: 'TDyeGqX4ranC94g7RMw6cGsCPvRQ7XAtQP',
  },
  {
    id: 'USDT_TON',
    name: 'USDT (TON)',
    network: 'TON Network',
    icon: TonIcon,
    calcAmount: (usd) => usd,
    formatAmount: (usd) => `${usd.toFixed(2)} USDT`,
    defaultAddress: 'UQA6ebFQPlulDzarfUtQJX8T61BHknM76VVYZ-3j-8eLnbyS',
  },
  {
    id: 'TON',
    name: 'TON',
    network: 'The Open Network',
    icon: TonIcon,
    calcAmount: (usd) => +(usd / 5.4).toFixed(2),
    formatAmount: (usd) => `${(usd / 5.4).toFixed(2)} TON`,
    defaultAddress: 'UQA6ebFQPlulDzarfUtQJX8T61BHknM76VVYZ-3j-8eLnbyS',
  },
  {
    id: 'BTC',
    name: 'Bitcoin',
    network: 'Bitcoin',
    icon: BitcoinIcon,
    calcAmount: (usd) => +(usd / 95000).toFixed(6),
    formatAmount: (usd) => `${(usd / 95000).toFixed(6)} BTC`,
    defaultAddress: 'bc1qa27xsypxy7pstvh2yrmzrlwev36qrr5az3vr7h',
  },
];
