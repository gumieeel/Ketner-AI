import type { Language } from '../preferences/preferences-store';
import type { TranslationKey } from '@/i18n';

export type PlanId = 'free' | 'gpt-pro' | 'claude-pro' | 'gemini-pro' | 'ultra' | 'plus' | 'pro';

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled';

export interface Subscription {
  userId: string;
  plan: PlanId;
  status: SubscriptionStatus;
  renewsAt: string | null;
}

export interface Plan {
  id: PlanId;
  nameKey: TranslationKey;
  priceMonthly: number;
  popular?: boolean;
  limitBadge?: Record<Language, string>;
  modelsHighlight?: Record<Language, string> | string;
  bullets: Record<Language, readonly string[]>;
  highlights?: Record<Language, readonly string[]>;
}

export type PaymentMethod = 'sbp' | 'crypto' | 'stars' | 'card';

/** Валюты и сети Trybit; полный справочник — trybit-currencies.ts. */
export type CryptoCurrency =
  | 'BTC'
  | 'LTC'
  | 'TRX'
  | 'SOL'
  | 'TON'
  | 'BNB'
  | 'ETH'
  | 'ETH_ARB'
  | 'ETH_BASE'
  | 'ETH_OPT'
  | 'USDT_TRC20'
  | 'USDT_BSC'
  | 'USDT_TON'
  | 'USDT_ERC20'
  | 'USDT_ARB'
  | 'USDT_OPT'
  | 'USDT_SOL'
  | 'USDC_BSC'
  | 'USDC_ERC20'
  | 'USDC_BASE'
  | 'USDC_ARB'
  | 'USDC_OPT'
  | 'USDC_SOL'
  | 'DAI_BSC'
  | 'DAI_ERC20'
  | 'DAI_BASE'
  | 'DAI_ARB'
  | 'DAI_OPT'
  | 'PYUSD_ERC20'
  | 'PYUSD_SOL'
  | 'USDD_TRC20'
  | 'XAUT_ERC20'
  | 'ARB_ARB'
  | 'OP_OPT'
  | 'SHIB_ERC20'
  | 'SHIB_BSC'
  | 'PEPE_ERC20'
  | 'TRUMP_SOL';

/** Комиссии Trybit по счёту, в долларах. */
export interface CryptoFees {
  serviceUsd: number;
  transferUsd: number;
  /** Сколько счёт дороже цены тарифа: эту часть комиссии платит покупатель. */
  payerUsd: number;
  totalUsd: number;
}

export interface CryptoInvoice {
  id: string;
  planId: PlanId;
  currency: CryptoCurrency;
  amount: number;
  amountUsd: number;
  address: string;
  qrPayload: string;
  status: 'pending' | 'confirming' | 'paid' | 'expired';
  expiresAt: string;
  network: string;
  cryptoCloudUrl?: string;
  cryptoCloudInvoiceId?: string;
  /** Trybit выдал реквизиты: оплата прямо на сайте, без перехода на страницу шлюза. */
  gatewayDetails?: boolean;
  /** MEMO/комментарий к переводу (сеть TON). */
  memo?: string;
  txHash?: string;
  fees?: CryptoFees;
}

export interface SbpInvoice {
  id: string;
  planId: PlanId;
  amount: number;
  currency: 'RUB';
  status: 'pending' | 'paid' | 'expired';
  qrPayload: string;
  deepLink: string;
  expiresAt: string;
}

export interface TelegramStarsInvoice {
  id: string;
  planId: PlanId;
  priceRub: number;
  starsAmount: number;
  /** Прямая ссылка на окно оплаты звёздами в Telegram (если бот настроен). */
  invoiceLink?: string;
  botUsername: string;
  botDeepLink: string;
  status: 'pending' | 'paid';
  expiresAt: string;
  /** Сколько эти звёзды стоят по официальному курсу Telegram, $. */
  starsUsd?: number;
  /** Официальный курс Telegram, по которому считается цена, $ за звезду. */
  usdPerStar?: number;
}
