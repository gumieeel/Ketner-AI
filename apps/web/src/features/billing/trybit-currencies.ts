import type { CryptoCurrency } from './types';

/**
 * Валюты и сети Trybit (support.trybit.com → «Валюты, сети и лимиты»).
 * Комиссии: сервис 1,9 % со входящего платежа; трансферная — Tron 1,4 $, Ethereum по загрузке сети,
 * в остальных сетях её нет. Комиссию сети блокчейна платит отправитель сверх суммы счёта.
 */
export const SERVICE_FEE_PERCENT = 1.9;
export const TRON_TRANSFER_FEE_USD = 1.4;

export type TransferFee = 'fixed' | 'dynamic' | 'none';

export interface Coin {
  id: string;
  name: string;
  /** Показываем в первом ряду выбора. */
  popular?: boolean;
  /** Стейблкоин: 1 монета ≈ 1 $, сумму можно показать до выставления счёта. */
  stable?: boolean;
  color: string;
}

export interface CryptoNetwork {
  code: CryptoCurrency;
  coin: string;
  network: string;
  transferFee: TransferFee;
}

export const COINS: readonly Coin[] = [
  { id: 'USDT', name: 'Tether', popular: true, stable: true, color: '#26a17b' },
  { id: 'BTC', name: 'Bitcoin', popular: true, color: '#f7931a' },
  { id: 'ETH', name: 'Ethereum', popular: true, color: '#627eea' },
  { id: 'TON', name: 'Toncoin', popular: true, color: '#0098ea' },
  { id: 'USDC', name: 'USD Coin', popular: true, stable: true, color: '#2775ca' },
  { id: 'TRX', name: 'Tron', popular: true, color: '#eb0029' },
  { id: 'SOL', name: 'Solana', popular: true, color: '#9945ff' },
  { id: 'BNB', name: 'BNB', popular: true, color: '#f0b90b' },
  { id: 'LTC', name: 'Litecoin', color: '#345d9d' },
  { id: 'DAI', name: 'Dai', stable: true, color: '#f5ac37' },
  { id: 'PYUSD', name: 'PayPal USD', stable: true, color: '#0070e0' },
  { id: 'USDD', name: 'USDD', stable: true, color: '#1d9a6c' },
  { id: 'XAUT', name: 'Tether Gold', color: '#c9a227' },
  { id: 'ARB', name: 'Arbitrum', color: '#28a0f0' },
  { id: 'OP', name: 'Optimism', color: '#ff0420' },
  { id: 'SHIB', name: 'Shiba Inu', color: '#e5430a' },
  { id: 'PEPE', name: 'Pepe', color: '#3d8b37' },
  { id: 'TRUMP', name: 'Official Trump', color: '#c4a35a' },
];

const TRON = 'Tron (TRC-20)';
const BSC = 'BNB Smart Chain (BEP-20)';
const ETHEREUM = 'Ethereum (ERC-20)';
const TON_NET = 'The Open Network (TON)';
const SOLANA = 'Solana (SOL)';
const ARBITRUM = 'Arbitrum';
const OPTIMISM = 'Optimism';
const BASE = 'Base';

const n = (code: CryptoCurrency, coin: string, network: string, transferFee: TransferFee = 'none'): CryptoNetwork => ({
  code,
  coin,
  network,
  transferFee,
});

/** Порядок внутри монеты — порядок показа; первая сеть выбирается по умолчанию. */
export const NETWORKS: readonly CryptoNetwork[] = [
  n('USDT_TRC20', 'USDT', TRON, 'fixed'),
  n('USDT_TON', 'USDT', TON_NET),
  n('USDT_BSC', 'USDT', BSC),
  n('USDT_SOL', 'USDT', SOLANA),
  n('USDT_ARB', 'USDT', ARBITRUM),
  n('USDT_OPT', 'USDT', OPTIMISM),
  n('USDT_ERC20', 'USDT', ETHEREUM, 'dynamic'),
  n('BTC', 'BTC', 'Bitcoin (BTC)'),
  n('ETH', 'ETH', ETHEREUM, 'dynamic'),
  n('ETH_ARB', 'ETH', ARBITRUM),
  n('ETH_BASE', 'ETH', BASE),
  n('ETH_OPT', 'ETH', OPTIMISM),
  n('TON', 'TON', TON_NET),
  n('USDC_BSC', 'USDC', BSC),
  n('USDC_SOL', 'USDC', SOLANA),
  n('USDC_BASE', 'USDC', BASE),
  n('USDC_ARB', 'USDC', ARBITRUM),
  n('USDC_OPT', 'USDC', OPTIMISM),
  n('USDC_ERC20', 'USDC', ETHEREUM, 'dynamic'),
  n('TRX', 'TRX', TRON, 'fixed'),
  n('SOL', 'SOL', SOLANA),
  n('BNB', 'BNB', BSC),
  n('LTC', 'LTC', 'Litecoin (LTC)'),
  n('DAI_BSC', 'DAI', BSC),
  n('DAI_BASE', 'DAI', BASE),
  n('DAI_ARB', 'DAI', ARBITRUM),
  n('DAI_OPT', 'DAI', OPTIMISM),
  n('DAI_ERC20', 'DAI', ETHEREUM, 'dynamic'),
  n('PYUSD_SOL', 'PYUSD', SOLANA),
  n('PYUSD_ERC20', 'PYUSD', ETHEREUM, 'dynamic'),
  n('USDD_TRC20', 'USDD', TRON, 'fixed'),
  n('XAUT_ERC20', 'XAUT', ETHEREUM, 'dynamic'),
  n('ARB_ARB', 'ARB', ARBITRUM),
  n('OP_OPT', 'OP', OPTIMISM),
  n('SHIB_BSC', 'SHIB', BSC),
  n('SHIB_ERC20', 'SHIB', ETHEREUM, 'dynamic'),
  n('PEPE_ERC20', 'PEPE', ETHEREUM, 'dynamic'),
  n('TRUMP_SOL', 'TRUMP', SOLANA),
];

export function networkOf(code: CryptoCurrency): CryptoNetwork {
  return NETWORKS.find((item) => item.code === code) ?? NETWORKS[0]!;
}

export function coinOf(code: CryptoCurrency): Coin {
  const coin = networkOf(code).coin;
  return COINS.find((item) => item.id === coin) ?? COINS[0]!;
}

export function networksOfCoin(coinId: string): CryptoNetwork[] {
  return NETWORKS.filter((item) => item.coin === coinId);
}

/** Оценка комиссий до выставления счёта; точные суммы приходят от Trybit в самом счёте. */
export function estimateFees(priceUsd: number, transferFee: TransferFee): { serviceUsd: number; transferUsd: number | null } {
  return {
    serviceUsd: Math.round(priceUsd * SERVICE_FEE_PERCENT) / 100,
    transferUsd: transferFee === 'fixed' ? TRON_TRANSFER_FEE_USD : transferFee === 'none' ? 0 : null,
  };
}
