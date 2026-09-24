import crypto from 'node:crypto';
export function createInvoiceStore() {
    const sbpInvoices = new Map();
    const starsInvoices = new Map();
    return {
        createSbpInvoice(userId, planId, amount) {
            const id = `sbp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
            const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
            const qrPayload = `https://qr.nspk.ru/AD10000KETNERAI${id}?type=02&bank=100000000111&sum=${amount * 100}&cur=RUB&crc=A9B4`;
            const deepLink = `https://qr.nspk.ru/AD10000KETNERAI${id}`;
            const invoice = {
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
        getSbpInvoice(id) {
            return sbpInvoices.get(id);
        },
        markSbpPaid(id) {
            const invoice = sbpInvoices.get(id);
            if (!invoice)
                return undefined;
            const updated = { ...invoice, status: 'paid' };
            sbpInvoices.set(id, updated);
            return updated;
        },
        createTelegramStarsInvoice(userId, planId, priceRub, starsAmount, botUsername) {
            const id = `stars_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
            const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
            const cleanUsername = botUsername.replace(/^@/, '');
            const botDeepLink = `https://t.me/${cleanUsername}?start=pay_${planId}__${userId}__${id}`;
            const invoice = {
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
        getTelegramStarsInvoice(id) {
            return starsInvoices.get(id);
        },
        markTelegramStarsPaid(id) {
            const invoice = starsInvoices.get(id);
            if (!invoice)
                return undefined;
            const updated = { ...invoice, status: 'paid' };
            starsInvoices.set(id, updated);
            return updated;
        },
    };
}
export const invoiceStore = createInvoiceStore();
