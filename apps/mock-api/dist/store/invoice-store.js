import crypto from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';
function readSnapshot(file) {
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        return {
            sbpInvoices: Array.isArray(parsed.sbpInvoices) ? parsed.sbpInvoices : [],
            starsInvoices: Array.isArray(parsed.starsInvoices) ? parsed.starsInvoices : [],
            cryptoInvoices: Array.isArray(parsed.cryptoInvoices) ? parsed.cryptoInvoices : [],
        };
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn('[mock-api] хранилище счетов не прочитано, начинаем с пустого:', error);
        }
        return { sbpInvoices: [], starsInvoices: [], cryptoInvoices: [] };
    }
}
function writeSnapshot(file, snapshot) {
    try {
        mkdirSync(dirname(file), { recursive: true });
        const temporary = `${file}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
        renameSync(temporary, file);
    }
    catch (error) {
        console.error('[mock-api] Ошибка записи хранилища счетов:', error);
    }
}
export function createInvoiceStore(file) {
    const sbpInvoices = new Map();
    const starsInvoices = new Map();
    const cryptoInvoices = new Map();
    if (file) {
        const snapshot = readSnapshot(file);
        for (const inv of snapshot.sbpInvoices)
            sbpInvoices.set(inv.id, inv);
        for (const inv of snapshot.starsInvoices)
            starsInvoices.set(inv.id, inv);
        for (const inv of snapshot.cryptoInvoices)
            cryptoInvoices.set(inv.id, inv);
    }
    const persist = () => {
        if (!file)
            return;
        writeSnapshot(file, {
            sbpInvoices: Array.from(sbpInvoices.values()),
            starsInvoices: Array.from(starsInvoices.values()),
            cryptoInvoices: Array.from(cryptoInvoices.values()),
        });
    };
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
            persist();
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
            persist();
            return updated;
        },
        createTelegramStarsInvoice(userId, planId, priceRub, starsAmount, botUsername) {
            const id = `stars_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
            const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
            const rawUser = botUsername && botUsername.trim() !== '' ? botUsername : 'Robo_kassa_bot';
            const cleanUsername = rawUser.replace(/^@/, '');
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
            persist();
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
            persist();
            return updated;
        },
        createCryptoInvoice(userId, planId, currency, amountUsd, cryptoCloudUrl, cryptoCloudInvoiceId) {
            const id = `crypto_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
            const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
            const amount = currency === 'TON'
                ? +(amountUsd / 5.4).toFixed(2)
                : currency === 'BTC'
                    ? +(amountUsd / 95000).toFixed(6)
                    : amountUsd;
            const address = currency === 'USDT_TRC20'
                ? 'TDyeGqX4ranC94g7RMw6cGsCPvRQ7XAtQP'
                : currency === 'BTC'
                    ? 'bc1qa27xsypxy7pstvh2yrmzrlwev36qrr5az3vr7h'
                    : 'UQA6ebFQPlulDzarfUtQJX8T61BHknM76VVYZ-3j-8eLnbyS';
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
                cryptoCloudUrl,
                cryptoCloudInvoiceId,
            };
            cryptoInvoices.set(id, invoice);
            persist();
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
            persist();
            return updated;
        },
    };
}
export const invoiceStore = createInvoiceStore(config.invoiceStoreFile);
