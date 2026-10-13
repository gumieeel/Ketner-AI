import crypto from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';
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
  markTelegramStarsPaid(id: string, chargeId?: string): TelegramStarsInvoice | undefined;
  setTelegramStarsLink?(id: string, invoiceLink: string): TelegramStarsInvoice | undefined;
  /** Оплаченные счета пользователя (звёзды и криптовалюта), новые сверху. */
  paidInvoicesOf?(userId: string): Array<{ id: string; method: 'stars' | 'crypto'; planId: PlanId; amount: string; paidAt: string }>;

  createCryptoInvoice(
    userId: string,
    planId: PlanId,
    currency: CryptoCurrency,
    amountUsd: number,
    cryptoCloudUrl?: string,
    cryptoCloudInvoiceId?: string,
    customId?: string,
    gateway?: CryptoGatewayDetails,
  ): CryptoInvoice;
  getCryptoInvoice(id: string): CryptoInvoice | undefined;
  findCryptoInvoice(identifier: string): CryptoInvoice | undefined;
  markCryptoPaid(id: string, txHash?: string): CryptoInvoice | undefined;
  /** Счета из Postgres: диск Render временный, без этого оплата после деплоя терялась бы. */
  loadCryptoExternal?(records: CryptoInvoice[]): void;
  setCryptoDbDriver?(driver: CryptoInvoiceDbDriver | null): void;
}

/** Реквизиты от Trybit для оплаты на сайте (H2H). */
export interface CryptoGatewayDetails {
  address: string;
  amount: number;
  network: string;
  expiresAt?: string;
  memo?: string;
}

/** Строка для QR: кошельки понимают адрес; для BTC и TON — стандартные ссылки с суммой. */
function gatewayQr(currency: CryptoCurrency, details: CryptoGatewayDetails): string {
  if (currency === 'BTC') return `bitcoin:${details.address}?amount=${details.amount}`;
  if (currency === 'TON') {
    const nano = Math.round(details.amount * 1e9);
    const text = details.memo ? `&text=${encodeURIComponent(details.memo)}` : '';
    return `ton://transfer/${details.address}?amount=${nano}${text}`;
  }
  return details.address;
}

export interface CryptoInvoiceDbDriver {
  upsert(invoice: CryptoInvoice): Promise<void>;
}

interface InvoiceSnapshot {
  sbpInvoices: SbpInvoice[];
  starsInvoices: TelegramStarsInvoice[];
  cryptoInvoices: CryptoInvoice[];
}

function readSnapshot(file: string): InvoiceSnapshot {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<InvoiceSnapshot>;
    return {
      sbpInvoices: Array.isArray(parsed.sbpInvoices) ? parsed.sbpInvoices : [],
      starsInvoices: Array.isArray(parsed.starsInvoices) ? parsed.starsInvoices : [],
      cryptoInvoices: Array.isArray(parsed.cryptoInvoices) ? parsed.cryptoInvoices : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[mock-api] хранилище счетов не прочитано, начинаем с пустого:', error);
    }
    return { sbpInvoices: [], starsInvoices: [], cryptoInvoices: [] };
  }
}

function writeSnapshot(file: string, snapshot: InvoiceSnapshot): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    renameSync(temporary, file);
  } catch (error) {
    console.error('[mock-api] Ошибка записи хранилища счетов:', error);
  }
}

export function createInvoiceStore(file?: string): InvoiceStore {
  const sbpInvoices = new Map<string, SbpInvoice>();
  const starsInvoices = new Map<string, TelegramStarsInvoice>();
  const cryptoInvoices = new Map<string, CryptoInvoice>();
  let cryptoDb: CryptoInvoiceDbDriver | null = null;
  const saveCrypto = (invoice: CryptoInvoice): void => {
    cryptoDb?.upsert({ ...invoice }).catch((error: unknown) => {
      console.error('[mock-api] Ошибка записи крипто-счёта в Postgres:', error);
    });
  };

  if (file) {
    const snapshot = readSnapshot(file);
    for (const inv of snapshot.sbpInvoices) sbpInvoices.set(inv.id, inv);
    for (const inv of snapshot.starsInvoices) starsInvoices.set(inv.id, inv);
    for (const inv of snapshot.cryptoInvoices) cryptoInvoices.set(inv.id, inv);
  }

  const persist = (): void => {
    if (!file) return;
    writeSnapshot(file, {
      sbpInvoices: Array.from(sbpInvoices.values()),
      starsInvoices: Array.from(starsInvoices.values()),
      cryptoInvoices: Array.from(cryptoInvoices.values()),
    });
  };

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
      persist();
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
      persist();
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
      const rawUser = botUsername && botUsername.trim() !== '' ? botUsername : 'Robo_kassa_bot';
      const cleanUsername = rawUser.replace(/^@/, '');
      const botDeepLink = `https://t.me/${cleanUsername}?start=${id}`;

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
      persist();
      return invoice;
    },

    getTelegramStarsInvoice(id: string): TelegramStarsInvoice | undefined {
      return starsInvoices.get(id);
    },

    markTelegramStarsPaid(id: string, chargeId?: string): TelegramStarsInvoice | undefined {
      const invoice = starsInvoices.get(id);
      if (!invoice) return undefined;
      const updated: TelegramStarsInvoice = {
        ...invoice,
        status: 'paid',
        paidAt: invoice.paidAt ?? new Date().toISOString(),
        ...(chargeId ? { chargeId } : {}),
      };
      starsInvoices.set(id, updated);
      persist();
      return updated;
    },

    setTelegramStarsLink(id: string, invoiceLink: string): TelegramStarsInvoice | undefined {
      const invoice = starsInvoices.get(id);
      if (!invoice) return undefined;
      const updated: TelegramStarsInvoice = { ...invoice, invoiceLink };
      starsInvoices.set(id, updated);
      persist();
      return updated;
    },

    paidInvoicesOf(userId: string) {
      const stars = [...starsInvoices.values()]
        .filter((inv) => inv.userId === userId && inv.status === 'paid')
        .map((inv) => ({
          id: inv.id,
          method: 'stars' as const,
          planId: inv.planId,
          amount: `${inv.starsAmount} ⭐`,
          paidAt: inv.paidAt ?? inv.createdAt,
        }));
      const crypto = [...cryptoInvoices.values()]
        .filter((inv) => inv.userId === userId && inv.status === 'paid')
        .map((inv) => ({
          id: inv.id,
          method: 'crypto' as const,
          planId: inv.planId,
          amount: `$${inv.amountUsd}`,
          paidAt: inv.createdAt,
        }));
      return [...stars, ...crypto].sort((a, b) => b.paidAt.localeCompare(a.paidAt)).slice(0, 20);
    },

    createCryptoInvoice(
      userId: string,
      planId: PlanId,
      currency: CryptoCurrency,
      amountUsd: number,
      cryptoCloudUrl?: string,
      cryptoCloudInvoiceId?: string,
      customId?: string,
      gateway?: CryptoGatewayDetails,
    ): CryptoInvoice {
      const id = customId || `crypto_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const amount =
        currency === 'TON'
          ? +(amountUsd / 5.4).toFixed(2)
          : currency === 'BTC'
            ? +(amountUsd / 95000).toFixed(6)
            : amountUsd;

      const address =
        currency === 'USDT_TRC20'
          ? 'TDyeGqX4ranC94g7RMw6cGsCPvRQ7XAtQP'
          : currency === 'BTC'
            ? 'bc1qa27xsypxy7pstvh2yrmzrlwev36qrr5az3vr7h'
            : 'UQA6ebFQPlulDzarfUtQJX8T61BHknM76VVYZ-3j-8eLnbyS';

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
        amount: gateway ? gateway.amount : amount,
        amountUsd,
        address: gateway ? gateway.address : address,
        qrPayload: gateway ? gatewayQr(currency, gateway) : qrPayload,
        status: 'pending',
        expiresAt: gateway?.expiresAt ?? expiresAt,
        createdAt: new Date().toISOString(),
        network: gateway?.network || network,
        cryptoCloudUrl,
        cryptoCloudInvoiceId,
        ...(gateway ? { gatewayDetails: true, ...(gateway.memo ? { memo: gateway.memo } : {}) } : {}),
      };

      cryptoInvoices.set(id, invoice);
      persist();
      saveCrypto(invoice);
      return invoice;
    },

    getCryptoInvoice(id: string): CryptoInvoice | undefined {
      return cryptoInvoices.get(id);
    },

    findCryptoInvoice(identifier: string): CryptoInvoice | undefined {
      if (!identifier) return undefined;
      const direct = cryptoInvoices.get(identifier);
      if (direct) return direct;
      // Trybit присылает invoice_id без префикса INV-, а при создании отдаёт uuid с ним.
      const bare = identifier.replace(/^INV-/i, '');
      for (const inv of cryptoInvoices.values()) {
        if (
          inv.id === identifier ||
          inv.cryptoCloudInvoiceId === identifier ||
          (inv.cryptoCloudInvoiceId && inv.cryptoCloudInvoiceId.replace(/^INV-/i, '') === bare) ||
          (inv.cryptoCloudUrl && inv.cryptoCloudUrl.includes(identifier))
        ) {
          return inv;
        }
      }
      return undefined;
    },

    markCryptoPaid(id: string, txHash?: string): CryptoInvoice | undefined {
      const invoice = this.findCryptoInvoice(id) ?? cryptoInvoices.get(id);
      if (!invoice) return undefined;
      const updated: CryptoInvoice = {
        ...invoice,
        status: 'paid',
        ...(txHash ? { txHash } : {}),
      };
      cryptoInvoices.set(invoice.id, updated);
      persist();
      saveCrypto(updated);
      return updated;
    },

    loadCryptoExternal(records: CryptoInvoice[]): void {
      for (const record of records) cryptoInvoices.set(record.id, { ...record });
    },

    setCryptoDbDriver(driver: CryptoInvoiceDbDriver | null): void {
      cryptoDb = driver;
    },
  };
}

export const invoiceStore = createInvoiceStore(config.invoiceStoreFile);
