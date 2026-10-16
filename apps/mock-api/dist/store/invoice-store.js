import crypto from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';
/** Строка для QR: кошельки понимают адрес; для BTC и TON — стандартные ссылки с суммой. */
function gatewayQr(currency, details) {
    if (currency === 'BTC')
        return `bitcoin:${details.address}?amount=${details.amount}`;
    if (currency === 'LTC')
        return `litecoin:${details.address}?amount=${details.amount}`;
    if (currency === 'TON') {
        const nano = Math.round(details.amount * 1e9);
        const text = details.memo ? `&text=${encodeURIComponent(details.memo)}` : '';
        return `ton://transfer/${details.address}?amount=${nano}${text}`;
    }
    return details.address;
}
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
    let cryptoDb = null;
    const saveCrypto = (invoice) => {
        cryptoDb?.upsert({ ...invoice }).catch((error) => {
            console.error('[mock-api] Ошибка записи крипто-счёта в Postgres:', error);
        });
    };
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
            const botDeepLink = `https://t.me/${cleanUsername}?start=${id}`;
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
        markTelegramStarsPaid(id, chargeId) {
            const invoice = starsInvoices.get(id);
            if (!invoice)
                return undefined;
            const updated = {
                ...invoice,
                status: 'paid',
                paidAt: invoice.paidAt ?? new Date().toISOString(),
                ...(chargeId ? { chargeId } : {}),
            };
            starsInvoices.set(id, updated);
            persist();
            return updated;
        },
        setTelegramStarsLink(id, invoiceLink) {
            const invoice = starsInvoices.get(id);
            if (!invoice)
                return undefined;
            const updated = { ...invoice, invoiceLink };
            starsInvoices.set(id, updated);
            persist();
            return updated;
        },
        paidInvoicesOf(userId) {
            const stars = [...starsInvoices.values()]
                .filter((inv) => inv.userId === userId && inv.status === 'paid')
                .map((inv) => ({
                id: inv.id,
                method: 'stars',
                planId: inv.planId,
                amount: `${inv.starsAmount} ⭐`,
                paidAt: inv.paidAt ?? inv.createdAt,
            }));
            const crypto = [...cryptoInvoices.values()]
                .filter((inv) => inv.userId === userId && inv.status === 'paid')
                .map((inv) => ({
                id: inv.id,
                method: 'crypto',
                planId: inv.planId,
                amount: `$${inv.amountUsd}`,
                paidAt: inv.createdAt,
            }));
            return [...stars, ...crypto].sort((a, b) => b.paidAt.localeCompare(a.paidAt)).slice(0, 20);
        },
        createCryptoInvoice(userId, planId, currency, amountUsd, cryptoCloudUrl, cryptoCloudInvoiceId, customId, gateway) {
            const id = customId || `crypto_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
            const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
            const amount = currency === 'TON'
                ? +(amountUsd / 5.4).toFixed(2)
                : currency === 'BTC'
                    ? +(amountUsd / 95000).toFixed(6)
                    : amountUsd;
            // Прямых переводов нет: адрес и QR выдаёт только Trybit (H2H), своих кошельков счёт не содержит.
            const network = currency === 'BTC' ? 'Bitcoin' : currency.startsWith('USDT_TRC') || currency === 'TRX' ? 'TRC-20' : currency.replace(/^[A-Z]+_?/, '') || currency;
            const invoice = {
                id,
                userId,
                planId,
                currency,
                amount: gateway ? gateway.amount : amount,
                amountUsd,
                address: gateway ? gateway.address : '',
                qrPayload: gateway ? gatewayQr(currency, gateway) : '',
                status: 'pending',
                expiresAt: gateway?.expiresAt ?? expiresAt,
                createdAt: new Date().toISOString(),
                network: gateway?.network || network,
                cryptoCloudUrl,
                cryptoCloudInvoiceId,
                ...(gateway ? { gatewayDetails: true, ...(gateway.memo ? { memo: gateway.memo } : {}) } : {}),
                ...(gateway?.fees
                    ? {
                        fees: {
                            serviceUsd: gateway.fees.serviceUsd,
                            transferUsd: gateway.fees.transferUsd,
                            payerUsd: Math.max(0, Math.round((gateway.fees.invoiceUsd - amountUsd) * 100) / 100),
                            totalUsd: Math.max(amountUsd, gateway.fees.invoiceUsd),
                        },
                    }
                    : {}),
            };
            cryptoInvoices.set(id, invoice);
            persist();
            saveCrypto(invoice);
            return invoice;
        },
        getCryptoInvoice(id) {
            return cryptoInvoices.get(id);
        },
        findCryptoInvoice(identifier) {
            if (!identifier)
                return undefined;
            const direct = cryptoInvoices.get(identifier);
            if (direct)
                return direct;
            // Trybit присылает invoice_id без префикса INV-, а при создании отдаёт uuid с ним.
            const bare = identifier.replace(/^INV-/i, '');
            for (const inv of cryptoInvoices.values()) {
                if (inv.id === identifier ||
                    inv.cryptoCloudInvoiceId === identifier ||
                    (inv.cryptoCloudInvoiceId && inv.cryptoCloudInvoiceId.replace(/^INV-/i, '') === bare) ||
                    (inv.cryptoCloudUrl && inv.cryptoCloudUrl.includes(identifier))) {
                    return inv;
                }
            }
            return undefined;
        },
        markCryptoPaid(id, txHash) {
            const invoice = this.findCryptoInvoice(id) ?? cryptoInvoices.get(id);
            if (!invoice)
                return undefined;
            const updated = {
                ...invoice,
                status: 'paid',
                ...(txHash ? { txHash } : {}),
            };
            cryptoInvoices.set(invoice.id, updated);
            persist();
            saveCrypto(updated);
            return updated;
        },
        loadCryptoExternal(records) {
            for (const record of records)
                cryptoInvoices.set(record.id, { ...record });
        },
        setCryptoDbDriver(driver) {
            cryptoDb = driver;
        },
    };
}
export const invoiceStore = createInvoiceStore(config.invoiceStoreFile);
