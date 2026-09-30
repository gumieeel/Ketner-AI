import crypto from 'node:crypto';
export function createInvoiceStore() {
    const sbpInvoices = new Map();
    const starsInvoices = new Map();
    const cryptoInvoices = new Map();
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
            const id = `stars_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
            const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
            const cleanUsername = botUsername.replace(/^@/, '');
            const botDeepLink = `https://t.me/${cleanUsername}?start=pay_${planId}__${id}`;
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
        createCryptoInvoice(userId, planId, currency, amountUsd) {
            const id = `crypto_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
            const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
            const amount = currency === 'TON'
                ? +(amountUsd / 5.4).toFixed(2)
                : currency === 'BTC'
                    ? +(amountUsd / 95000).toFixed(6)
                    : amountUsd;
            const address = currency === 'USDT_TRC20'
                ? 'TXwKetnerAI78Qz99Trc20DepositXyZ9'
                : currency === 'BTC'
                    ? 'bc1qketnerai99depositbtcsecured88zz'
                    : 'EQBKetnerAITonUsdtWalletDeposit88xY';
            const network = currency === 'USDT_TRC20' ? 'TRC-20' : currency === 'BTC' ? 'Bitcoin' : 'TON';
            const qrPayload = currency === 'USDT_TRC20'
                ? `tron:${address}?amount=${amount}`
                : currency === 'BTC'
                    ? `bitcoin:${address}?amount=${amount}`
                    : `ton://transfer/${address}?amount=${amount}`;
            const invoice = {
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
        getCryptoInvoice(id) {
            return cryptoInvoices.get(id);
        },
        markCryptoPaid(id) {
            const invoice = cryptoInvoices.get(id);
            if (!invoice)
                return undefined;
            const updated = { ...invoice, status: 'paid' };
            cryptoInvoices.set(id, updated);
            return updated;
        },
    };
}
export const invoiceStore = createInvoiceStore();
