import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import type { PlanId } from '../types.js';

export interface CryptoCloudCreateInvoiceOptions {
  orderId: string;
  amountUsd: number;
  planId: PlanId;
  userId: string;
  userEmail?: string;
  cryptocurrency?: string;
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
    const key = config.cryptoCloudApiKey !== undefined ? config.cryptoCloudApiKey.trim() : this.apiKey;
    const shop = config.cryptoCloudShopId !== undefined ? config.cryptoCloudShopId.trim() : this.shopId;
    return Boolean(key && shop);
  }

  /**
   * Проверяет подлинность postback CryptoCloud.
   *
   * Поле `token` — JWT (HS256), подписанный секретным ключом проекта (CRYPTOCLOUD_SECRET_KEY).
   * Без ключа проверить нечем, поэтому postback отклоняется: «нет ключа — верим всем» недопустимо.
   */
  verifyPostbackToken(token: unknown): boolean {
    if (!this.secretKey || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

    try {
      const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as {
        alg?: string;
      };
      if (header.alg !== 'HS256') return false;

      const expected = createHmac('sha256', this.secretKey)
        .update(`${encodedHeader}.${encodedPayload}`)
        .digest();
      const given = Buffer.from(encodedSignature, 'base64url');
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;

      const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
        exp?: number;
      };
      if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Создает счет на оплату в CryptoCloud API v2.
   * Демонстрационный URL существует только вне production; в production без ключей
   * или при ошибке API выбрасывается исключение (вызывающий код его обрабатывает).
   */
  async createInvoice(options: CryptoCloudCreateInvoiceOptions): Promise<CryptoCloudInvoiceResult> {
    if (!this.isConfigured()) {
      if (!config.enableMockBilling) {
        throw new Error('CryptoCloud не настроен (CRYPTOCLOUD_API_KEY / CRYPTOCLOUD_SHOP_ID)');
      }
      // Демо-ссылка для локальной разработки и тестов
      const fakeUuid = `INV-${options.orderId.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase()}`;
      return {
        invoiceId: fakeUuid,
        link: `https://cryptocloud.plus/pay/${fakeUuid}`,
        status: 'created',
      };
    }

    try {
      const response = await fetch(`${config.cryptoCloudApiUrl}/v2/invoice/create`, {
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
          // Дополнительные параметры Trybit принимает только внутри add_fields.
          ...(options.cryptocurrency ? { add_fields: { cryptocurrency: options.cryptocurrency } } : {}),
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
      if (!config.enableMockBilling) {
        throw error;
      }
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
   * Endpoint: POST <TRYBIT_API_URL>/v2/invoice/merchant/info
   */
  async checkInvoiceStatus(invoiceId: string): Promise<string> {
    if (!this.isConfigured()) {
      return 'pending';
    }

    try {
      const response = await fetch(`${config.cryptoCloudApiUrl}/v2/invoice/merchant/info`, {
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
        const bare = (value: string) => value.replace(/^INV-/i, '');
        const item = data.result.find((inv) => bare(inv.uuid) === bare(invoiceId));
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
