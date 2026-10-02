import { config } from '../config.js';
import type { PlanId } from '../types.js';

export interface CryptoCloudCreateInvoiceOptions {
  orderId: string;
  amountUsd: number;
  planId: PlanId;
  userId: string;
  userEmail?: string;
}

export interface CryptoCloudInvoiceResult {
  invoiceId: string;
  link: string;
  expiry?: string;
  status: string;
}

export class CryptoCloudService {
  private apiKey: string;
  private shopId: string;
  private secretKey: string;

  constructor() {
    this.apiKey = config.cryptoCloudApiKey?.trim() || '';
    this.shopId = config.cryptoCloudShopId?.trim() || '';
    this.secretKey = config.cryptoCloudSecretKey?.trim() || '';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.shopId);
  }

  /**
   * Проверяет токен вебхука CryptoCloud, если CRYPTOCLOUD_SECRET_KEY настроен.
   */
  verifyWebhookToken(token?: string): boolean {
    if (!this.secretKey) return true;
    return token === this.secretKey;
  }

  /**
   * Создает счет на оплату в CryptoCloud API v2.
   * При отсутствии ключей возвращает демонстрационный платежный URL для тестов.
   */
  async createInvoice(options: CryptoCloudCreateInvoiceOptions): Promise<CryptoCloudInvoiceResult> {
    if (!this.isConfigured()) {
      // Демо-ссылка для локальной разработки и тестов
      const fakeUuid = `INV-${options.orderId.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase()}`;
      return {
        invoiceId: fakeUuid,
        link: `https://cryptocloud.plus/pay/${fakeUuid}`,
        status: 'created',
      };
    }

    try {
      const response = await fetch('https://api.cryptocloud.plus/v2/invoice/create', {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          shop_id: this.shopId,
          amount: options.amountUsd,
          currency: 'USD',
          order_id: options.orderId,
          email: options.userEmail || undefined,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[cryptocloud] Create invoice error response:', response.status, errorText);
        throw new Error(`CryptoCloud API error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as {
        status: string;
        result?: {
          uuid: string;
          link: string;
          expiry?: string;
          status?: string;
        };
        message?: string;
      };

      if (data.status !== 'success' || !data.result) {
        throw new Error(data.message || 'CryptoCloud: не удалось создать счёт');
      }

      return {
        invoiceId: data.result.uuid,
        link: data.result.link,
        expiry: data.result.expiry,
        status: data.result.status || 'created',
      };
    } catch (error) {
      console.error('[cryptocloud] Ошибка вызова CryptoCloud API:', error);
      const fakeUuid = `INV-${options.orderId.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase()}`;
      return {
        invoiceId: fakeUuid,
        link: `https://cryptocloud.plus/pay/${fakeUuid}`,
        status: 'created',
      };
    }
  }

  /**
   * Проверяет статус счета через CryptoCloud API v2.
   * Endpoint: POST https://api.cryptocloud.plus/v2/invoice/merchant/info
   */
  async checkInvoiceStatus(invoiceId: string): Promise<string> {
    if (!this.isConfigured()) {
      return 'pending';
    }

    try {
      const response = await fetch('https://api.cryptocloud.plus/v2/invoice/merchant/info', {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uuids: [invoiceId] }),
      });

      if (!response.ok) {
        console.warn(`[cryptocloud] checkInvoiceStatus HTTP ${response.status} for ${invoiceId}`);
        return 'pending';
      }

      const data = (await response.json()) as {
        status: string;
        result?: Array<{
          uuid: string;
          status: string;
          amount?: number;
          amount_usd?: number;
        }>;
      };

      if (data.status === 'success' && Array.isArray(data.result)) {
        const item = data.result.find((inv) => inv.uuid === invoiceId);
        if (item?.status) {
          const rawStatus = item.status.toLowerCase();
          return rawStatus; // 'paid', 'created', 'partial', 'overpaid', 'canceled'
        }
      }

      return 'pending';
    } catch (err) {
      console.warn('[cryptocloud] checkInvoiceStatus network error:', err);
      return 'pending';
    }
  }
}

export const cryptoCloudService = new CryptoCloudService();
