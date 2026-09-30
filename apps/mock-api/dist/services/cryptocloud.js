import { config } from '../config.js';
export class CryptoCloudService {
    apiKey;
    shopId;
    secretKey;
    constructor() {
        this.apiKey = config.cryptoCloudApiKey?.trim() || '';
        this.shopId = config.cryptoCloudShopId?.trim() || '';
        this.secretKey = config.cryptoCloudSecretKey?.trim() || '';
    }
    isConfigured() {
        return Boolean(this.apiKey && this.shopId);
    }
    /**
     * Проверяет токен вебхука CryptoCloud, если CRYPTOCLOUD_SECRET_KEY настроен.
     */
    verifyWebhookToken(token) {
        if (!this.secretKey)
            return true;
        return token === this.secretKey;
    }
    /**
     * Создает счет на оплату в CryptoCloud API v2.
     * При отсутствии ключей возвращает демонстрационный платежный URL для тестов.
     */
    async createInvoice(options) {
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
            const data = (await response.json());
            if (data.status !== 'success' || !data.result) {
                throw new Error(data.message || 'CryptoCloud: не удалось создать счёт');
            }
            return {
                invoiceId: data.result.uuid,
                link: data.result.link,
                expiry: data.result.expiry,
                status: data.result.status || 'created',
            };
        }
        catch (error) {
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
     */
    async checkInvoiceStatus(invoiceId) {
        if (!this.isConfigured()) {
            return 'pending';
        }
        try {
            const response = await fetch(`https://api.cryptocloud.plus/v2/invoice/info?uuid=${encodeURIComponent(invoiceId)}`, {
                headers: {
                    Authorization: `Token ${this.apiKey}`,
                },
            });
            if (!response.ok)
                return 'pending';
            const data = (await response.json());
            if (data.status === 'success' && data.result?.status) {
                return data.result.status; // 'created', 'paid', 'canceled', etc.
            }
            return 'pending';
        }
        catch {
            return 'pending';
        }
    }
}
export const cryptoCloudService = new CryptoCloudService();
