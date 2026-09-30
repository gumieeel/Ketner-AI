import crypto from 'node:crypto';
import type { CryptoCurrency, CryptoInvoice, PlanId, SbpInvoice, TelegramStarsInvoice } from '../types.js';

export interface InvoiceStore {
  createSbpInvoice(userId: string, planId: PlanId, amount: number): SbpInvoice;
  getSbpInvoice(id: string): SbpInvoice | undefined;
  markSbpPaid(id: string): SbpInvoice | undefined;

  createTelegramStarsInvoice(
    userId: string,
    planId: PlanId,
    priceRub: number,
    starsAmount: number,
    botUsername: string,
  ): TelegramStarsInvoice;
  getTelegramStarsInvoice(id: string): TelegramStarsInvoice | undefined;
  markTelegramStarsPaid(id: string): TelegramStarsInvoice | undefined;

  createCryptoInvoice(
    userId: string,
    planId: PlanId,
    currency: CryptoCurrency,
    amountUsd: number,
  ): CryptoInvoice;
  getCryptoInvoice(id: string): CryptoInvoice | undefined;
  markCryptoPaid(id: string): CryptoInvoice | undefined;
}

export function createInvoiceStore(): InvoiceStore {
  const sbpInvoices = new Map<string, SbpInvoice>();
  const starsInvoices = new Map<string, TelegramStarsInvoice>();
  const cryptoInvoices = new Map<string, CryptoInvoice>();

  return {
    createSbpInvoice(userId: string, planId: PlanId, amount: number): SbpInvoice {
      const id = `sbp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const qrPayload = `https://qr.nspk.ru/AD10000KETNERAI${id}?type=02&bank=100000000111&sum=${amount * 100}&cur=RUB&crc=A9B4`;
      const deepLink = `https://qr.nspk.ru/AD10000KETNERAI${id}`;

      const invoice: SbpInvoice = {
        id,
        userId,
        planId,
        amount,
        currency: 'RUB',
        status: 'pending',
        qrPayload,
        deepLink,
        expiresAt,
        createdAt: new Date().toISOString(),
      };

      sbpInvoices.set(id, invoice);
      return invoice;
    },

    getSbpInvoice(id: string): SbpInvoice | undefined {
      return sbpInvoices.get(id);
    },

    markSbpPaid(id: string): SbpInvoice | undefined {
      const invoice = sbpInvoices.get(id);
      if (!invoice) return undefined;
      const updated: SbpInvoice = { ...invoice, status: 'paid' };
      sbpInvoices.set(id, updated);
      return updated;
    },

    createTelegramStarsInvoice(
      userId: string,
      planId: PlanId,
      priceRub: number,
      starsAmount: number,
      botUsername: string,
    ): TelegramStarsInvoice {
      const id = `stars_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const cleanUsername = botUsername.replace(/^@/, '');
      const botDeepLink = `https://t.me/${cleanUsername}?start=pay_${planId}__${id}`;

      const invoice: TelegramStarsInvoice = {
        id,
        userId,
        planId,
        priceRub,
        starsAmount,
        botUsername: cleanUsername,
        botDeepLink,
        status: 'pending',
        expiresAt,
        createdAt: new Date().toISOString(),
      };

      starsInvoices.set(id, invoice);
      return invoice;
    },

    getTelegramStarsInvoice(id: string): TelegramStarsInvoice | undefined {
      return starsInvoices.get(id);
    },

    markTelegramStarsPaid(id: string): TelegramStarsInvoice | undefined {
      const invoice = starsInvoices.get(id);
      if (!invoice) return undefined;
      const updated: TelegramStarsInvoice = { ...invoice, status: 'paid' };
      starsInvoices.set(id, updated);
      return updated;
    },

    createCryptoInvoice(
      userId: string,
      planId: PlanId,
      currency: CryptoCurrency,
      amountUsd: number,
    ): CryptoInvoice {
      const id = `crypto_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const amount =
        currency === 'TON'
          ? +(amountUsd / 5.4).toFixed(2)
          : currency === 'BTC'
            ? +(amountUsd / 95000).toFixed(6)
            : amountUsd;

      const address =
        currency === 'USDT_TRC20'
          ? 'TXwKetnerAI78Qz99Trc20DepositXyZ9'
          : currency === 'BTC'
            ? 'bc1qketnerai99depositbtcsecured88zz'
            : 'EQBKetnerAITonUsdtWalletDeposit88xY';

      const network =
        currency === 'USDT_TRC20' ? 'TRC-20' : currency === 'BTC' ? 'Bitcoin' : 'TON';

      const qrPayload =
        currency === 'USDT_TRC20'
          ? `tron:${address}?amount=${amount}`
          : currency === 'BTC'
            ? `bitcoin:${address}?amount=${amount}`
            : `ton://transfer/${address}?amount=${amount}`;

      const invoice: CryptoInvoice = {
        id,
        userId,
        planId,
        currency,
        amount,
        amountUsd,
        address,
        qrPayload,
        status: 'pending',
        expiresAt,
        createdAt: new Date().toISOString(),
        network,
      };

      cryptoInvoices.set(id, invoice);
      return invoice;
    },

    getCryptoInvoice(id: string): CryptoInvoice | undefined {
      return cryptoInvoices.get(id);
    },

    markCryptoPaid(id: string): CryptoInvoice | undefined {
      const invoice = cryptoInvoices.get(id);
      if (!invoice) return undefined;
      const updated: CryptoInvoice = { ...invoice, status: 'paid' };
      cryptoInvoices.set(id, updated);
      return updated;
    },
  };
}

export const invoiceStore = createInvoiceStore();

